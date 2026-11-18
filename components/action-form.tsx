"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";

/**
 * Form wrapper for server actions. Keeps input on error (React 19 resets uncontrolled forms),
 * clears after success, reports through sonner toasts + inline text, and can require a confirmation dialog.
 */
export function ActionForm({ action, submit, className, variant, children, resetOnSuccess = true, confirm, disabled }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  submit: string;
  className?: string;
  variant?: "default" | "outline" | "destructive";
  resetOnSuccess?: boolean;
  /** When set, an AlertDialog with this message is shown before submitting. */
  confirm?: string;
  /** Disables the submit button (e.g. nothing selected yet). */
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const [state, run, pending] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const wantsReset = useRef(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!state) return;
    if (state.error) toast.error(state.error);
    if (state.ok) {
      toast.success(state.ok);
      if (wantsReset.current) { formRef.current?.reset(); wantsReset.current = false; }
    }
  }, [state]);

  function submitNow() {
    const data = new FormData(formRef.current!);
    wantsReset.current = resetOnSuccess;
    startTransition(() => { run(data); });
  }

  return (
    <>
      <form ref={formRef} className={className} onSubmit={(e) => { e.preventDefault(); if (confirm) setConfirming(true); else submitNow(); }}>
        {children}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-full">
          <Button type="submit" variant={variant} disabled={pending || disabled}>{pending ? "Working…" : submit}</Button>
          {state?.error && <span role="alert" className="text-sm text-destructive">{state.error}</span>}
        </div>
      </form>
      {confirm && (
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Please confirm</AlertDialogTitle><AlertDialogDescription>{confirm}</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className={cn(variant === "destructive" && buttonVariants({ variant: "destructive" }))} onClick={submitNow}>{submit}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
