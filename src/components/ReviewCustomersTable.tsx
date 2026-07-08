"use client";

import { useMemo, useState, useTransition } from "react";
import {
  sendReviewToCustomerAction,
  sendReviewBulkAction,
  createReviewTaskAction,
} from "@/app/dashboard/bewertungen/actions";

export interface ReviewCustomerRow {
  id: number;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  categoryName: string | null;
  alreadySent: boolean;
  sentAt: string | null;
}

const hasEmail = (r: ReviewCustomerRow) => !!(r.email ?? "").trim();

export interface ReviewHistoryDisplay {
  name: string | null;
  email: string | null;
  sentAt: string;
  sentBy: string | null;
}

interface AssignableUser {
  id: number;
  name: string;
}

type Filter = "offen" | "versendet" | "alle";

const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

/** yyyy-mm-dd in +days Tagen (Standard-Fälligkeit). */
function defaultDueDate(days = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ReviewCustomersTable({
  rows,
  history,
  assignableUsers,
}: {
  rows: ReviewCustomerRow[];
  history: ReviewHistoryDisplay[];
  assignableUsers: AssignableUser[];
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("offen");
  const [onlyEmail, setOnlyEmail] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sentIds, setSentIds] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [showHistory, setShowHistory] = useState(false);

  // Aufgabe-Modal
  const [taskFor, setTaskFor] = useState<ReviewCustomerRow | null>(null);
  const [taskAssignees, setTaskAssignees] = useState<Set<number>>(new Set());
  const [taskDue, setTaskDue] = useState<string>(defaultDueDate());
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskErr, setTaskErr] = useState<string | null>(null);

  const openTaskModal = (r: ReviewCustomerRow) => {
    setTaskFor(r);
    setTaskAssignees(new Set());
    setTaskDue(defaultDueDate());
    setTaskErr(null);
  };
  const submitTask = () => {
    if (!taskFor || taskBusy) return;
    const assignedTo = [...taskAssignees];
    if (assignedTo.length === 0) {
      setTaskErr("Bitte mindestens einen Mitarbeiter auswählen.");
      return;
    }
    if (!taskDue) {
      setTaskErr("Bitte ein Fälligkeitsdatum angeben.");
      return;
    }
    setTaskBusy(true);
    setTaskErr(null);
    const target = taskFor;
    startTransition(async () => {
      const res = await createReviewTaskAction({
        customerId: target.id,
        name: target.name,
        email: target.email ?? "",
        phone: target.phone ?? "",
        assignedTo,
        dueDate: taskDue,
      });
      setTaskBusy(false);
      if (res.ok) {
        setTaskFor(null);
        setMsg({ kind: "ok", text: `Aufgabe „Kundenzufriedenheit erfragen" für ${target.name} erstellt.` });
      } else {
        setTaskErr(res.error ?? "Aufgabe konnte nicht erstellt werden.");
      }
    });
  };

  const isSent = (r: ReviewCustomerRow) => r.alreadySent || sentIds.has(r.id);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const sent = r.alreadySent || sentIds.has(r.id);
      if (filter === "offen" && sent) return false;
      if (filter === "versendet" && !sent) return false;
      if (onlyEmail && !hasEmail(r)) return false;
      if (!q) return true;
      return [r.name, r.companyName ?? "", r.city ?? "", r.email ?? "", r.phone ?? "", r.categoryName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, search, filter, onlyEmail, sentIds]);

  // Für den Sammelversand nur Kunden MIT E-Mail (per Mail erreichbar).
  const selectableFiltered = filtered.filter((r) => !isSent(r) && hasEmail(r));
  const allSelected = selectableFiltered.length > 0 && selectableFiltered.every((r) => selected.has(r.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) selectableFiltered.forEach((r) => next.delete(r.id));
      else selectableFiltered.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sendOne = (r: ReviewCustomerRow) => {
    if (!r.email || isSent(r) || pending) return;
    setMsg(null);
    setBusyId(r.id);
    startTransition(async () => {
      const res = await sendReviewToCustomerAction({ customerId: r.id, name: r.name, email: r.email! });
      setBusyId(null);
      if (res.ok) {
        setSentIds((p) => new Set(p).add(r.id));
        setSelected((p) => {
          const n = new Set(p);
          n.delete(r.id);
          return n;
        });
        setMsg({ kind: "ok", text: `Bewertungs-Anfrage an ${r.name} gesendet.` });
      } else if (res.alreadySent) {
        setSentIds((p) => new Set(p).add(r.id));
        setMsg({ kind: "err", text: `${r.name} hat bereits eine Anfrage erhalten.` });
      } else {
        setMsg({ kind: "err", text: res.error ?? "Versand fehlgeschlagen." });
      }
    });
  };

  const sendBulk = () => {
    const targets = rows.filter((r) => selected.has(r.id) && !isSent(r) && r.email);
    if (targets.length === 0 || pending) return;
    if (!window.confirm(`${targets.length} Bewertungs-Anfrage(n) jetzt per E-Mail versenden?`)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await sendReviewBulkAction(
        targets.map((r) => ({ customerId: r.id, name: r.name, email: r.email! }))
      );
      if (!res.ok) {
        setMsg({ kind: "err", text: res.error ?? "Versand fehlgeschlagen." });
        return;
      }
      setSentIds((p) => {
        const n = new Set(p);
        targets.forEach((r) => n.add(r.id));
        return n;
      });
      setSelected(new Set());
      const parts = [`${res.sent} gesendet`];
      if (res.skipped) parts.push(`${res.skipped} übersprungen`);
      if (res.failed) parts.push(`${res.failed} fehlgeschlagen`);
      setMsg({
        kind: res.failed ? "err" : "ok",
        text:
          parts.join(", ") +
          (res.failedNames.length ? ` (Fehler: ${res.failedNames.slice(0, 5).join(", ")})` : "") +
          ".",
      });
    });
  };

  const openCount = rows.filter((r) => !isSent(r)).length;
  const sentCount = rows.length - openCount;
  const selectedCount = rows.filter((r) => selected.has(r.id) && !isSent(r)).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Steuerleiste */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Kunden durchsuchen (Name, Firma, Ort, E-Mail)…"
          className="w-full max-w-sm rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-red focus:outline-none"
        />
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-300">
          {(
            [
              ["offen", `Offen (${openCount})`],
              ["versendet", `Versendet (${sentCount})`],
              ["alle", `Alle (${rows.length})`],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                filter === key ? "bg-brand-red text-white" : "bg-white text-gray-700 hover:bg-gray-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={onlyEmail}
            onChange={(e) => setOnlyEmail(e.target.checked)}
            className="h-4 w-4 accent-brand-red"
          />
          nur mit E-Mail
        </label>
        <button
          type="button"
          onClick={sendBulk}
          disabled={selectedCount === 0 || pending}
          className="ml-auto rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending && busyId === null ? "Sende …" : `${selectedCount} auswählte senden`}
        </button>
      </div>

      {msg && (
        <div
          className={`rounded-md border p-3 text-sm ${
            msg.kind === "ok"
              ? "border-green-300 bg-green-50 text-green-800"
              : "border-brand-red/30 bg-brand-red/10 text-red-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Tabelle */}
      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="max-h-[calc(100vh-20rem)] overflow-y-auto overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-200 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b-2 [&>th]:border-white/10 [&>th]:bg-[#191c20]">
                <th className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Alle auswählen"
                    className="h-4 w-4 accent-brand-red"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Name / Firma</th>
                <th className="px-4 py-3 font-medium">Ort</th>
                <th className="px-4 py-3 font-medium">E-Mail</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-gray-500">
                    Keine Kunden gefunden.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const sent = isSent(r);
                  return (
                    <tr key={r.id} className="border-b border-gray-200 last:border-0 hover:bg-gray-100">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleOne(r.id)}
                          disabled={sent || !hasEmail(r)}
                          title={!hasEmail(r) ? "Keine E-Mail – nur per Aufgabe/Anruf" : undefined}
                          aria-label={`${r.name} auswählen`}
                          className="h-4 w-4 accent-brand-red disabled:opacity-40"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-900">{r.name}</div>
                        {r.companyName && r.companyName !== r.name && (
                          <div className="text-xs text-gray-500">{r.companyName}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-700">{r.city ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-700">
                        {hasEmail(r) ? (
                          r.email
                        ) : r.phone ? (
                          <span className="text-gray-500" title="Keine E-Mail – telefonisch erreichbar">
                            ☎ {r.phone}
                          </span>
                        ) : (
                          <span className="text-gray-400">keine E-Mail</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {sent ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            ✓ versendet{r.sentAt ? ` · ${fmtDate(r.sentAt)}` : ""}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            offen
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openTaskModal(r)}
                            disabled={pending}
                            title="Aufgabe Kundenzufriedenheit erfragen erstellen"
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Aufgabe
                          </button>
                          <button
                            type="button"
                            onClick={() => sendOne(r)}
                            disabled={sent || pending || !hasEmail(r)}
                            title={!hasEmail(r) ? "Keine E-Mail hinterlegt – bitte Aufgabe (Anruf) erstellen" : undefined}
                            className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {busyId === r.id ? "Sende …" : sent ? "Erledigt" : "Senden"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Historie */}
      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <button
          type="button"
          onClick={() => setShowHistory((s) => !s)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <span className="text-sm font-medium text-gray-900">
            Versand-Historie ({history.length})
          </span>
          <span className="text-gray-500">{showHistory ? "▲" : "▼"}</span>
        </button>
        {showHistory && (
          <div className="max-h-80 overflow-y-auto border-t border-gray-200">
            {history.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-gray-500">Noch keine Anfragen versendet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2 font-medium">Datum</th>
                    <th className="px-4 py-2 font-medium">Kunde</th>
                    <th className="px-4 py-2 font-medium">E-Mail</th>
                    <th className="px-4 py-2 font-medium">Von</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="whitespace-nowrap px-4 py-2 text-gray-700">{fmtDate(h.sentAt)}</td>
                      <td className="px-4 py-2 text-gray-800">{h.name ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-600">{h.email ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-600">{h.sentBy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Aufgabe-Modal */}
      {taskFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !taskBusy && setTaskFor(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900">Aufgabe: Kundenzufriedenheit erfragen</h3>
            <p className="mt-1 text-sm text-gray-600">
              Für <span className="font-medium text-gray-900">{taskFor.name}</span>
              {taskFor.email ? <> · {taskFor.email}</> : taskFor.phone ? <> · ☎ {taskFor.phone}</> : null}
            </p>

            <div className="mt-4 flex flex-col gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Zuweisen an</label>
                {assignableUsers.length === 0 ? (
                  <p className="text-sm text-gray-500">Keine Mitarbeiter verfügbar.</p>
                ) : (
                  <div className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-lg border border-gray-300 p-2">
                    {assignableUsers.map((u) => (
                      <label key={u.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-gray-800 hover:bg-gray-100">
                        <input
                          type="checkbox"
                          checked={taskAssignees.has(u.id)}
                          onChange={() =>
                            setTaskAssignees((prev) => {
                              const n = new Set(prev);
                              if (n.has(u.id)) n.delete(u.id);
                              else n.add(u.id);
                              return n;
                            })
                          }
                          className="h-4 w-4 accent-brand-red"
                        />
                        {u.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="taskDue" className="mb-1 block text-sm font-medium text-gray-700">
                  Fällig am
                </label>
                <input
                  id="taskDue"
                  type="date"
                  value={taskDue}
                  onChange={(e) => setTaskDue(e.target.value)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-red focus:outline-none"
                />
              </div>

              {taskErr && <p className="text-sm text-red-600">{taskErr}</p>}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTaskFor(null)}
                disabled={taskBusy}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={submitTask}
                disabled={taskBusy}
                className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {taskBusy ? "Erstelle …" : "Aufgabe erstellen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
