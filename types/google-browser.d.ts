/**
 * The two Google browser globals this app touches, typed only as far as it uses them.
 *
 * @types/gapi and @types/google.picker would describe the whole of both APIs — every view,
 * every feature, every upload surface — which is a larger commitment than a picker button
 * earns, and a standing invitation to reach for the parts of Drive this product is built
 * not to touch. The narrow local copy is the smaller thing to maintain.
 */

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  /** Scopes as actually granted, space-delimited. A user may grant fewer than were asked. */
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GoogleTokenResponse) => void;
  /** Non-OAuth failures: a blocked popup, or a window closed before Google answered. */
  error_callback?: (error: { type?: string; message?: string }) => void;
  login_hint?: string;
  prompt?: string;
  include_granted_scopes?: boolean;
}

interface GoogleTokenClient {
  requestAccessToken(overrideConfig?: { prompt?: string; login_hint?: string }): void;
}

interface GooglePickerDocsView {
  setIncludeFolders(include: boolean): GooglePickerDocsView;
  setSelectFolderEnabled(enabled: boolean): GooglePickerDocsView;
  setOwnedByMe(ownedByMe: boolean): GooglePickerDocsView;
  setMimeTypes(mimeTypes: string): GooglePickerDocsView;
}

interface GooglePickerObject {
  setVisible(visible: boolean): void;
}

interface GooglePickerBuilder {
  addView(view: GooglePickerDocsView): GooglePickerBuilder;
  setOAuthToken(token: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  setTitle(title: string): GooglePickerBuilder;
  setOrigin(origin: string): GooglePickerBuilder;
  enableFeature(feature: string): GooglePickerBuilder;
  /** Keyed by the Response constants below rather than by literal names. */
  setCallback(callback: (data: Record<string, unknown>) => void): GooglePickerBuilder;
  build(): GooglePickerObject;
}

interface GooglePickerNamespace {
  DocsView: new (viewId?: string) => GooglePickerDocsView;
  PickerBuilder: new () => GooglePickerBuilder;
  ViewId: { DOCS: string };
  Feature: { MULTISELECT_ENABLED: string };
  Action: { PICKED: string; CANCEL: string };
  Response: { ACTION: string; DOCUMENTS: string };
}

interface Window {
  google?: {
    accounts?: {
      oauth2?: { initTokenClient(config: GoogleTokenClientConfig): GoogleTokenClient };
    };
    picker?: GooglePickerNamespace;
  };
  gapi?: { load(name: string, callback: () => void): void };
}
