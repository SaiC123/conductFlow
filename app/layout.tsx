import "./globals.css";
export const metadata = { title: "ConductFlow", description: "Turn client conversations into tracked commitments." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
