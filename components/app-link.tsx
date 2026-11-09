"use client";
import type { ComponentProps } from "react";
import { appHref } from "@/lib/client-runtime";
export default function AppLink({ href = "/", ...props }: ComponentProps<"a">) {
  return <a {...props} href={appHref(href)} />;
}
