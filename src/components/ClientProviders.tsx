"use client";

import { ConfigProvider } from "antd";
import { XProvider } from "@ant-design/x";

export default function ClientProviders({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <ConfigProvider>
      <XProvider>{children}</XProvider>
    </ConfigProvider>
  );
}
