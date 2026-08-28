import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scavenger Hunt | Classroom Activity",
  description: "Choose your assigned number and discover your classroom scavenger-hunt mission.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
