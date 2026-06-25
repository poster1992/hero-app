"use client";

import { useMemo, useState } from "react";
import type { CustomerSummary } from "@/lib/hero-api";

export default function CustomersTable({ customers }: { customers: CustomerSummary[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [c.name, c.companyName ?? "", c.city ?? "", c.zipcode ?? "", c.email ?? "", c.nr ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [customers, search]);

  return (
    <div className="flex flex-col gap-4">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Kunden durchsuchen (Name, Firma, Ort, PLZ, E-Mail)…"
        className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-red focus:outline-none"
      />

      <div className="rounded-xl border border-gray-300 bg-white shadow-lg shadow-black/10">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-medium text-gray-900">Kunden</h2>
          <p className="text-sm text-gray-600">{filtered.length} Kontakte</p>
        </div>

        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">Keine Kunden gefunden.</p>
        ) : (
          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-gray-700 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:border-b-2 [&>th]:border-white/10 [&>th]:bg-[#191c20]">
                  <th className="px-4 py-3 font-medium">Nr.</th>
                  <th className="px-4 py-3 font-medium">Name / Firma</th>
                  <th className="px-4 py-3 font-medium">Adresse</th>
                  <th className="px-4 py-3 font-medium">Telefon</th>
                  <th className="px-4 py-3 font-medium">E-Mail</th>
                  <th className="px-4 py-3 font-medium">Kategorie</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-gray-200 last:border-0 hover:bg-gray-100"
                  >
                    <td className="whitespace-nowrap px-4 py-2 text-gray-600">{c.nr ?? "—"}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-900">{c.name}</div>
                      {c.companyName && c.companyName !== c.name && (
                        <div className="text-xs text-gray-500">{c.companyName}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-700">
                      {[c.street, [c.zipcode, c.city].filter(Boolean).join(" ")]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-700">{c.phone ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-700">
                      {c.email ? (
                        <a
                          href={`mailto:${c.email}`}
                          className="text-brand-red hover:underline"
                        >
                          {c.email}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-500">
                      {c.categoryName ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
