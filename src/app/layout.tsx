import type { Metadata } from "next";
import "antd/dist/reset.css";
import "highlight.js/styles/github-dark.css";
import "./globals.css";
import ClientProviders from "@/components/ClientProviders";

export const metadata: Metadata = {
  title: "LLMX Chat",
  description: "Next.js + Ant Design X + DeepSeek streaming chat"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
