"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createFixkostenAction,
  updateFixkostenAction,
  deleteFixkostenAction,
  createLinkedFixkostenAction,
  searchFixkostenReceiptsAction,
  addFixkostenReceiptAction,
  removeFixkostenReceiptLinkAction,
  getFixkostenReceiptFileUrlAction,
} from "@/app/dashboard/fixkosten/actions";
import type { FixkostenItem, FixkostenLinkSource, FixkostenReceiptOption } from "@/lib/fixkosten";
import type { BookAccount } from "@/lib/hero-api";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2.5 text-base text-gray-900 outline-none focus:border-brand-red/60";

function fmtEur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/** Konto-Such-/Auswahlfeld (gleiches Muster wie im Beleg-Formular), trägt die Auswahl in ein Hidden-Input ein. */
function AccountPicker({
  accounts,
  value,
  onChange,
}: {
  accounts: BookAccount[];
  value: { number: string; name: string } | null;
  onChange: (v: { number: string; name: string } | null) => void;
}) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches =
    words.length === 0 || value
      ? []
      : accounts
          .filter((a) => {
            const hay = `${a.number} ${a.name}`.toLowerCase();
            return words.every((w) => hay.includes(w));
          })
          .slice(0, 12);

  return (
    <div>
      <input type="hidden" name="account" value={value ? `${value.number}|${value.name}` : ""} />
      {value ? (
        <div className="flex items-center justify-between rounded-md border border-gray-300 px-3 py-2 text-sm">
          <span className="text-gray-900">
            {value.number} – {value.name}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
            className="text-xs text-gray-400 hover:text-gray-700"
          >
            ✕ ändern
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="GuV-Konto suchen (Nr. oder Schlagwort) …"
            className={inputClass}
          />
          {matches.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
              {matches.map((a) => (
                <li key={a.number}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(a);
                      setQuery("");
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
                  >
                    <span className="text-gray-500">{a.number}</span> {a.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Öffnet den Beleg eines Verknüpfungseintrags in einem neuen Tab (Fenster sofort öffnen, URL erst bei Klick auflösen). */
function openReceiptFile(kind: "manual" | "hero", ref: string) {
  const win = window.open("", "_blank");
  getFixkostenReceiptFileUrlAction(kind, ref).then((res) => {
    if (res.url && win) win.location.href = res.url;
    else if (win) win.close();
    if (res.error && !res.url) alert(res.error);
  });
}

/** Suche + Liste der verknüpften Belege für eine Fixkosten-Position (nur sichtbar, wenn geöffnet). */
function ReceiptsPanel({ item }: { item: FixkostenItem }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FixkostenReceiptOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [busyLinkId, setBusyLinkId] = useState<number | null>(null);

  const runSearch = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    setSearchError(null);
    const res = await searchFixkostenReceiptsAction(query);
    setSearching(false);
    setResults(res.results);
    if (res.error) setSearchError(res.error);
  };

  const addReceipt = async (option: FixkostenReceiptOption) => {
    setBusyRef(`${option.kind}:${option.ref}`);
    const res = await addFixkostenReceiptAction(item.id, option);
    setBusyRef(null);
    if (!res.ok) {
      setSearchError(res.error ?? "Fehler beim Verknüpfen");
      return;
    }
    setResults([]);
    setQuery("");
    router.refresh();
  };

  const removeLink = async (linkId: number) => {
    setBusyLinkId(linkId);
    await removeFixkostenReceiptLinkAction(linkId);
    setBusyLinkId(null);
    router.refresh();
  };

  return (
    <tr className="border-b border-gray-100 bg-gray-50/70">
      <td colSpan={5} className="px-5 py-4">
        <div className="flex flex-col gap-3">
          {item.receiptLinks && item.receiptLinks.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {item.receiptLinks.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => openReceiptFile(l.kind, l.ref)}
                    className="text-left text-brand-red hover:underline"
                  >
                    {l.supplier ?? "Unbekannt"}
                    {l.invoiceNumber ? ` · ${l.invoiceNumber}` : ""} · {fmtEur(l.amount)}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeLink(l.id)}
                    disabled={busyLinkId === l.id}
                    className="shrink-0 text-xs text-gray-400 hover:text-rose-600 disabled:opacity-50"
                  >
                    ✕ entfernen
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch();
                }
              }}
              placeholder="Beleg suchen (Lieferant, Belegnummer, Volltext) …"
              className={inputClass}
            />
            <button
              type="button"
              onClick={runSearch}
              disabled={searching || query.trim().length < 2}
              className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {searching ? "…" : "Suchen"}
            </button>
          </div>

          {searchError && <p className="text-sm text-rose-600">{searchError}</p>}
          {!searching && !searchError && query.trim().length >= 2 && results.length === 0 && (
            <p className="text-sm text-gray-400">Keine Treffer.</p>
          )}
          {results.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {results.map((r) => {
                const key = `${r.kind}:${r.ref}`;
                return (
                  <li key={key} className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
                    <span>
                      {r.supplier ?? "Unbekannt"}
                      {r.invoiceNumber ? ` · ${r.invoiceNumber}` : ""}
                      {r.date ? ` · ${r.date.split("-").reverse().join(".")}` : ""} · {fmtEur(r.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => addReceipt(r)}
                      disabled={busyRef === key}
                      className="shrink-0 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                    >
                      {busyRef === key ? "…" : "+ verknüpfen"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </td>
    </tr>
  );
}

function Row({ item, accounts }: { item: FixkostenItem; accounts: BookAccount[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [belegeOpen, setBelegeOpen] = useState(false);
  const [name, setName] = useState(item.name);
  const [amount, setAmount] = useState(String(item.monthlyAmount).replace(".", ","));
  const [account, setAccount] = useState<{ number: string; name: string } | null>(
    item.accountNumber ? { number: item.accountNumber, name: item.accountName ?? "" } : null
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const resetFields = () => {
    setName(item.name);
    setAmount(String(item.monthlyAmount).replace(".", ","));
    setAccount(item.accountNumber ? { number: item.accountNumber, name: item.accountName ?? "" } : null);
    setError(null);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const accountRaw = account ? `${account.number}|${account.name}` : "";
      const res = await updateFixkostenAction(item.id, name, amount, accountRaw);
      if (!res.ok) {
        setError(res.error ?? "Fehler beim Speichern");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const remove = () => {
    if (!confirm(`„${item.name}“ wirklich löschen?`)) return;
    startTransition(async () => {
      await deleteFixkostenAction(item.id);
      router.refresh();
    });
  };

  if (editing) {
    return (
      <tr className="border-b border-gray-100">
        <td className="px-5 py-3">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </td>
        <td className="px-5 py-3 text-sm text-gray-500">
          {item.linkedSource && (
            <>
              <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                🔗 verknüpft
              </span>
              {item.linkedDetail && <div className="mt-1">{item.linkedDetail}</div>}
            </>
          )}
        </td>
        <td className="px-5 py-3">
          {item.linkedSource ? (
            <span className="block text-right text-gray-500">{fmtEur(item.monthlyAmount)} (automatisch)</span>
          ) : (
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className={`${inputClass} text-right`}
            />
          )}
        </td>
        <td className="px-5 py-3">
          <AccountPicker accounts={accounts} value={account} onChange={setAccount} />
        </td>
        <td className="px-5 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            {error && <span className="text-xs text-rose-600">{error}</span>}
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-md bg-brand-red px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Speichern
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                resetFields();
              }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Abbrechen
            </button>
          </div>
        </td>
      </tr>
    );
  }

  const canLinkReceipts = item.linkedSource == null || item.linkedSource === "belege";

  return (
    <>
      <tr className="border-b border-gray-100 last:border-0">
        <td className="px-5 py-3.5 font-medium text-gray-900">{item.name}</td>
        <td className="px-5 py-3.5 text-sm text-gray-500">
          {item.linkedSource && (
            <>
              <span
                className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700"
                title="Betrag wird automatisch berechnet"
              >
                🔗 verknüpft
              </span>
              {item.linkedDetail && <div className="mt-1">{item.linkedDetail}</div>}
            </>
          )}
        </td>
        <td className="px-5 py-3.5 text-right text-gray-600">{fmtEur(item.monthlyAmount)}</td>
        <td className="px-5 py-3.5 text-gray-600">
          {item.accountNumber ? (
            <span>
              {item.accountNumber} – {item.accountName}
            </span>
          ) : (
            <span className="text-gray-400">kein Konto</span>
          )}
        </td>
        <td className="px-5 py-3.5 text-right">
          <div className="flex items-center justify-end gap-2">
            {canLinkReceipts && (
              <button
                type="button"
                onClick={() => setBelegeOpen((v) => !v)}
                className="rounded-md border border-sky-300 bg-white px-3 py-1.5 text-sm font-semibold text-sky-700 hover:bg-sky-50"
              >
                🧾 Belege{item.receiptLinks && item.receiptLinks.length > 0 ? ` (${item.receiptLinks.length})` : ""}
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Bearbeiten
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="rounded-md border border-rose-300 px-3 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            >
              Löschen
            </button>
          </div>
        </td>
      </tr>
      {belegeOpen && canLinkReceipts && <ReceiptsPanel item={item} />}
    </>
  );
}

const LINK_BUTTONS: { source: FixkostenLinkSource; label: string }[] = [
  { source: "fahrzeug_leasing", label: "🔗 Fahrzeug Leasing verknüpfen" },
  { source: "lohnkosten", label: "🔗 Lohnkosten verknüpfen" },
];

export default function FixkostenClient({ items, accounts }: { items: FixkostenItem[]; accounts: BookAccount[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newAccount, setNewAccount] = useState<{ number: string; name: string } | null>(null);
  const [linkPendingSource, setLinkPendingSource] = useState<FixkostenLinkSource | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkTransitionPending, startLinkTransition] = useTransition();

  const total = items.reduce((sum, i) => sum + i.monthlyAmount, 0);
  const linkedSources = new Set(items.map((i) => i.linkedSource).filter(Boolean));
  const availableLinks = LINK_BUTTONS.filter((l) => !linkedSources.has(l.source));

  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const res = await createFixkostenAction(formData);
      if (!res.ok) {
        setError(res.error ?? "Fehler beim Anlegen");
        return;
      }
      formRef.current?.reset();
      setNewAccount(null);
      router.refresh();
    });
  };

  const addLink = (source: FixkostenLinkSource) => {
    setLinkError(null);
    setLinkPendingSource(source);
    startLinkTransition(async () => {
      const res = await createLinkedFixkostenAction(source);
      if (!res.ok) {
        setLinkError(res.error ?? "Fehler beim Verknüpfen");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <form
        ref={formRef}
        action={submit}
        className="grid grid-cols-1 gap-2 border border-line bg-white p-4 sm:grid-cols-2 sm:items-end"
      >
        <div>
          <label className="mb-1 block text-sm text-gray-500">Bezeichnung *</label>
          <input name="name" placeholder="z. B. Miete Halle" className={inputClass} required />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-500">Monatlicher Betrag € *</label>
          <input name="monthlyAmount" inputMode="decimal" placeholder="0,00" className={inputClass} required />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm text-gray-500">GuV-Konto (optional)</label>
          <AccountPicker accounts={accounts} value={newAccount} onChange={setNewAccount} />
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Legt an …" : "Hinzufügen"}
          </button>
          {error && <span className="text-xs text-rose-600">{error}</span>}
        </div>
      </form>

      {availableLinks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border border-dashed border-sky-300 bg-sky-50/50 p-3">
          <span className="text-sm text-gray-700">
            Statt einen Betrag selbst einzutragen, kann eine Position auch automatisch aus einem anderen Modul
            berechnet werden:
          </span>
          {availableLinks.map((l) => (
            <button
              key={l.source}
              type="button"
              onClick={() => addLink(l.source)}
              disabled={linkTransitionPending}
              className="rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
            >
              {linkTransitionPending && linkPendingSource === l.source ? "Verknüpft …" : l.label}
            </button>
          ))}
          {linkError && <span className="text-xs text-rose-600">{linkError}</span>}
        </div>
      )}

      <div className="overflow-x-auto border border-line bg-white">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-5 py-3">Bezeichnung</th>
              <th className="px-5 py-3">Verknüpfung</th>
              <th className="px-5 py-3 text-right">Monatlicher Betrag</th>
              <th className="px-5 py-3">GuV-Konto</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-sm text-gray-500">
                  Noch keine Fixkosten erfasst.
                </td>
              </tr>
            ) : (
              items.map((item) => <Row key={item.id} item={item} accounts={accounts} />)
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900">
                <td className="px-5 py-3">Summe pro Monat</td>
                <td className="px-5 py-3" />
                <td className="px-5 py-3 text-right">{fmtEur(total)}</td>
                <td className="px-5 py-3" colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
