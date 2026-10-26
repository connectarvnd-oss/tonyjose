"use client";

import { useFormStatus } from "react-dom";
import { btnCls } from "./ui";

export function SubmitButton({ children, className, confirm, name, value }: { children: React.ReactNode; className?: string; confirm?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={className ?? btnCls}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? "Working…" : children}
    </button>
  );
}
