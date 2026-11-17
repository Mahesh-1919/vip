import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** Label + control + hint + error: the single layout every form field uses. */
export function FormField({ label, htmlFor, hint, error, required, className, children }: {
  label: React.ReactNode; htmlFor?: string; hint?: React.ReactNode; error?: string; required?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}{required && <span aria-hidden> *</span>}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

type Common = { label: React.ReactNode; name: string; hint?: React.ReactNode; error?: string; className?: string };

export function TextField({ label, name, hint, error, className, required, ...input }: Common & Omit<React.ComponentProps<typeof Input>, "name" | "className">) {
  return (
    <FormField label={label} htmlFor={name} hint={hint} error={error} required={required} className={className}>
      <Input id={name} name={name} required={required} aria-invalid={!!error || undefined} {...input} />
    </FormField>
  );
}

export function SelectField({ label, name, options, placeholder, hint, error, className, required, ...select }: Common & {
  options: { value: string; label: string }[]; placeholder?: string;
} & Omit<React.ComponentProps<typeof NativeSelect>, "name" | "className">) {
  return (
    <FormField label={label} htmlFor={name} hint={hint} error={error} required={required} className={className}>
      <NativeSelect id={name} name={name} required={required} aria-invalid={!!error || undefined} {...select}>
        {placeholder !== undefined && <NativeSelectOption value="">{placeholder}</NativeSelectOption>}
        {options.map((o) => <NativeSelectOption key={o.value} value={o.value}>{o.label}</NativeSelectOption>)}
      </NativeSelect>
    </FormField>
  );
}

export function TextareaField({ label, name, hint, error, className, required, ...ta }: Common & Omit<React.ComponentProps<typeof Textarea>, "name" | "className">) {
  return (
    <FormField label={label} htmlFor={name} hint={hint} error={error} required={required} className={className}>
      <Textarea id={name} name={name} required={required} aria-invalid={!!error || undefined} {...ta} />
    </FormField>
  );
}

export function CheckboxField({ label, name, className, ...cb }: { label: React.ReactNode; name: string; className?: string } & Omit<React.ComponentProps<typeof Checkbox>, "name" | "className">) {
  return (
    <div className={cn("flex items-center gap-2 text-sm", className)}>
      <Checkbox id={name} name={name} {...cb} />
      <Label htmlFor={name} className="font-normal">{label}</Label>
    </div>
  );
}
