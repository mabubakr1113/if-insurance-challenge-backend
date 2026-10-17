import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "If Home Watch API",
  description: "Backend API for the If Home Watch prototype.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "3rem 1.5rem", color: "#1f2937" }}>
        {children}
      </body>
    </html>
  );
}
