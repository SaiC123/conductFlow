import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;
type Result = { data: unknown; error: Error | null };

export function fakeDb(tables: Tables, options: {
  failTable?: string;
  beforeRpc?: (name: string) => void;
  beforeUpdate?: (table: string) => void;
} = {}): SupabaseClient {
  const rows = (table: string) => tables[table] ?? (tables[table] = []);
  let sequence = 0;
  function insert(table: string, row: Row): Row {
    const value = { id: `generated-${sequence++}`, ...row };
    rows(table).push(value);
    return value;
  }
  return {
    from(table: string) {
      function chain(
        matchers: Array<(r: Row) => boolean> = [], patch?: Row,
        order?: string, range?: [number, number],
      ) {
        let result: Result | undefined;
        function run(): Result {
          if (result) return result;
          if (patch && options.failTable === table) return { data: null, error: new Error("write failed") };
          if (patch) options.beforeUpdate?.(table);
          let matched = rows(table).filter((r) => matchers.every((m) => m(r)));
          if (order) matched.sort((a, b) => String(a[order]).localeCompare(String(b[order])));
          if (range) matched = matched.slice(range[0], range[1] + 1);
          if (patch) matched.forEach((row) => Object.assign(row, patch));
          result = { data: matched.map((row) => ({ ...row })), error: null };
          return result;
        }
        return {
          select() { return chain(matchers, patch, order, range); },
          eq(column: string, value: unknown) {
            return chain([...matchers, (r) => r[column] === value], patch, order, range);
          },
          is(column: string, value: unknown) {
            return chain([...matchers, (r) => (r[column] ?? null) === value], patch, order, range);
          },
          in(column: string, values: unknown[]) {
            return chain([...matchers, (r) => values.includes(r[column])], patch, order, range);
          },
          lt(column: string, value: string) {
            return chain([...matchers, (r) => typeof r[column] === "string" && r[column] < value], patch, order, range);
          },
          order(column: string) { return chain(matchers, patch, column, range); },
          range(start: number, end: number) { return chain(matchers, patch, order, [start, end]); },
          async maybeSingle() {
            const value = run();
            const list = value.data as Row[] | null;
            return { ...value, data: list?.[0] ?? null };
          },
          then(resolve: (value: Result) => unknown) { return Promise.resolve(run()).then(resolve); },
        };
      }
      return {
        select() { return chain(); },
        update(patch: Row) { return chain([], patch); },
        insert(row: Row) {
          const result = options.failTable === table
            ? { data: null, error: new Error("write failed") }
            : { data: insert(table, row), error: null };
          return {
            select() { return { async single() { return result; } }; },
            then(resolve: (value: Result) => unknown) { return Promise.resolve(result).then(resolve); },
          };
        },
      };
    },
    async rpc(name: string, args: Row) {
      options.beforeRpc?.(name);
      if (options.failTable === "client_message_draft") return { data: null, error: new Error("write failed") };
      if (name === "create_time_invoice") {
        const invoice = args.p_invoice as Row;
        const entries = rows("time_entry").filter((entry) =>
          (args.p_entry_ids as string[]).includes(entry.id as string)
          && entry.org_id === invoice.org_id && entry.client_id === invoice.client_id && !entry.invoiced);
        if (entries.length !== (args.p_entry_ids as string[]).length) {
          return { data: null, error: new Error("time entries changed; retry invoice drafting") };
        }
        insert("invoice", { status: "draft", last_reminded_at: null, ...invoice });
        entries.forEach((entry) => Object.assign(entry, { invoiced: true, invoice_id: invoice.id }));
        insert("client_message_draft", { ...(args.p_message as Row), org_id: invoice.org_id,
          client_id: invoice.client_id, source_id: invoice.id, kind: "invoice" });
        return { data: null, error: null };
      }
      if (name === "draft_invoice_collection") {
        const invoice = rows("invoice").find((row) => row.id === args.p_invoice_id && row.org_id === args.p_org_id);
        if (!invoice || invoice.status !== "overdue" || invoice.total_cents !== args.p_total_cents
          || invoice.due_date !== args.p_due_date
          || (invoice.last_reminded_at && Date.parse(invoice.last_reminded_at as string)
            >= Date.parse(args.p_now as string) - 7 * 24 * 60 * 60 * 1000)) {
          return { data: false, error: null };
        }
        insert("client_message_draft", { org_id: invoice.org_id, client_id: invoice.client_id,
          source_id: invoice.id, kind: "collections_reminder", subject: args.p_subject, body: args.p_body });
        invoice.last_reminded_at = args.p_now;
        return { data: true, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  } as unknown as SupabaseClient;
}
