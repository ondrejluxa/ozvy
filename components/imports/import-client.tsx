"use client";

import { createClient } from "@supabase/supabase-js";
import { Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/inputs";
import {
  backToMappingAction,
  cancelImportAction,
  commitImportAction,
  reparseImportAction,
  saveMappingAction,
  setRowExcludedAction,
  startImportAction,
  uploadFinishedAction,
  type MappingFormState,
} from "@/lib/actions/imports";
import { TEXT_ENCODINGS } from "@/lib/domain/imports/detect";
import { TARGET_FIELDS, type ColumnMapping } from "@/lib/domain/imports/mapping";

// ---------- upload ----------

/**
 * The file goes from the browser straight to the private storage bucket via a
 * signed upload URL (20 MB never passes through a server action).
 */
export function ImportUploadForm({
  companyId,
  supabaseUrl,
  supabaseAnonKey,
}: {
  companyId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}) {
  const t = useTranslations("imports");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [type, setType] = useState<"visits" | "customers">("visits");
  // Read from the input on submit: a file chosen before hydration is still picked up.
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const file = fileInput.current?.files?.[0];
      if (!file) return;
      const started = await startImportAction({ companyId, type, fileName: file.name, fileSize: file.size });
      if (!started.ok) {
        toast.error(tErrors(started.error.code));
        return;
      }
      const storage = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } }).storage;
      const { error } = await storage
        .from("imports")
        .uploadToSignedUrl(started.data.path, started.data.token, file, { contentType: file.type || "text/plain" });
      if (error) {
        toast.error(t("upload.failed"));
        return;
      }
      const finished = await uploadFinishedAction({ companyId, importId: started.data.importId });
      if (!finished.ok) {
        toast.error(tErrors(finished.error.code));
        return;
      }
      router.push(`/admin/companies/${companyId}/imports/${started.data.importId}`);
    });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-ink-2">{t("upload.type")}</legend>
        {(["visits", "customers"] as const).map((value) => (
          <label key={value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="type"
              value={value}
              checked={type === value}
              onChange={() => setType(value)}
              className="mt-1 accent-[var(--color-accent)]"
            />
            <span>
              <span className="font-medium text-ink">{t(`types.${value}`)}</span>
              <span className="block text-[12px] text-muted">{t(`typeHints.${value}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="import-file">{t("upload.file")}</Label>
        <Input
          id="import-file"
          type="file"
          accept=".csv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="h-auto py-1.5"
          ref={fileInput}
          required
        />
      </div>
      <Button type="submit" variant="accent" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
        {pending ? t("upload.uploading") : t("upload.submit")}
      </Button>
    </form>
  );
}

// ---------- progress ----------

/** While a job works, re-render the server page every 1.5 s. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 1_500);
    return () => clearInterval(id);
  }, [router]);
  return null;
}

// ---------- mapping ----------

export function ReparseControls({
  companyId,
  importId,
  encoding,
  sheet,
  sheetNames,
}: {
  companyId: string;
  importId: string;
  encoding: string | null;
  sheet: string | null;
  sheetNames: string[];
}) {
  const t = useTranslations("imports.mapping");
  const tErrors = useTranslations("errors");
  const [value, setValue] = useState(encoding ?? sheet ?? "");
  const [pending, startTransition] = useTransition();
  const isSheet = sheetNames.length > 0;
  if (isSheet && sheetNames.length < 2) return null;

  const reparse = () =>
    startTransition(async () => {
      const res = await reparseImportAction(
        isSheet ? { companyId, importId, sheet: value } : { companyId, importId, encoding: value },
      );
      if (!res.ok) toast.error(tErrors(res.error.code));
    });

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1.5">
        <Label htmlFor="reparse">{isSheet ? t("sheet") : t("encoding")}</Label>
        <Select id="reparse" value={value} onChange={(e) => setValue(e.target.value)} className="w-56">
          {isSheet
            ? sheetNames.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))
            : TEXT_ENCODINGS.map((e) => (
                <option key={e} value={e}>
                  {t(`encodings.${e}`)}
                </option>
              ))}
        </Select>
      </div>
      <Button type="button" variant="outline" onClick={reparse} disabled={pending || value === (encoding ?? sheet)}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {t("reparse")}
      </Button>
    </div>
  );
}

export function MappingForm({
  companyId,
  importId,
  header,
  mapping,
  legalBasis,
}: {
  companyId: string;
  importId: string;
  header: string[];
  mapping: ColumnMapping;
  legalBasis: string | null;
}) {
  const t = useTranslations("imports.mapping");
  const [state, action, pending] = useActionState(saveMappingAction, {} as MappingFormState);
  const problems = [...(state.problems ?? []), ...(state.error ? [state.error] : [])];

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="importId" value={importId} />
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {TARGET_FIELDS.map((field) => (
          <div key={field} className="space-y-1">
            <Label htmlFor={`map-${field}`}>{t(`fields.${field}`)}</Label>
            <Select id={`map-${field}`} name={`map_${field}`} defaultValue={mapping[field]?.toString() ?? ""}>
              <option value="">{t("unused")}</option>
              {header.map((h, i) => (
                <option key={i} value={i}>
                  {h || `#${i + 1}`}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>

      <fieldset className="space-y-3 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-ink">{t("legal.title")}</legend>
        <p className="text-[13px] text-muted">{t("legal.description")}</p>
        <div className="space-y-1.5">
          <Label htmlFor="legal-basis">{t("legal.label")}</Label>
          <Select
            id="legal-basis"
            name="legal_basis"
            defaultValue={legalBasis ?? "existing_customer"}
            className="sm:w-96"
          >
            <option value="existing_customer">{t("legal.existing_customer")}</option>
            <option value="consent">{t("legal.consent")}</option>
            <option value="unknown">{t("legal.unknown")}</option>
            <option value="">{t("legal.fromColumn")}</option>
          </Select>
        </div>
        <label className="flex items-start gap-2 text-sm text-ink-2">
          <input type="checkbox" name="legal_basis_confirmed" className="mt-0.5 size-4 accent-[var(--color-accent)]" />
          <span>{t("legal.confirm")}</span>
        </label>
      </fieldset>

      {problems.length > 0 && (
        <div role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {problems.map((p) => (
            <p key={p}>{t(`problems.${p}`)}</p>
          ))}
        </div>
      )}
      <Button type="submit" variant="accent" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {pending ? t("saving") : t("submit")}
      </Button>
    </form>
  );
}

// ---------- review ----------

export function RowExcludeToggle({
  companyId,
  importId,
  rowNumber,
  excluded,
}: {
  companyId: string;
  importId: string;
  rowNumber: number;
  excluded: boolean;
}) {
  const t = useTranslations("imports.review");
  const tErrors = useTranslations("errors");
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await setRowExcludedAction({ companyId, importId, rowNumber, excluded: !excluded });
          if (!res.ok) toast.error(tErrors(res.error.code));
        })
      }
    >
      {excluded ? t("include") : t("exclude")}
    </Button>
  );
}

export function ImportActions({
  companyId,
  importId,
  status,
  committable,
  resumable,
}: {
  companyId: string;
  importId: string;
  status: string;
  committable: number;
  resumable: boolean;
}) {
  const t = useTranslations("imports");
  const tErrors = useTranslations("errors");
  const [pending, startTransition] = useTransition();
  const call = (fn: () => Promise<{ ok: boolean; error?: { code: string } }>, success?: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(tErrors(res.error!.code));
      else if (success) toast.success(success);
    });
  const input = { companyId, importId };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "needs_review" && (
        <>
          <Button
            variant="accent"
            disabled={pending || committable === 0}
            onClick={() => call(() => commitImportAction(input))}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {committable === 0 ? t("review.nothing") : t("review.commit", { count: committable })}
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => call(() => backToMappingAction(input))}>
            {t("review.backToMapping")}
          </Button>
        </>
      )}
      {resumable && (
        <Button variant="accent" disabled={pending} onClick={() => call(() => commitImportAction(input))}>
          {t("retryCommit")}
        </Button>
      )}
      {["uploaded", "mapping", "needs_review", "failed"].includes(status) && (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => call(() => cancelImportAction(input), t("cancelled"))}
        >
          {t("cancel")}
        </Button>
      )}
    </div>
  );
}

/**
 * An import stuck in parsing or validating (no update for 30 minutes, alert
 * import_stuck): nothing has been written to customers yet, so it can be
 * cancelled and the file uploaded again.
 */
export function StuckImportCancel({ companyId, importId }: { companyId: string; importId: string }) {
  const t = useTranslations("imports");
  const tErrors = useTranslations("errors");
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await cancelImportAction({ companyId, importId });
          if (!res.ok) toast.error(tErrors(res.error.code));
          else toast.success(t("cancelled"));
        })
      }
    >
      {t("cancel")}
    </Button>
  );
}
