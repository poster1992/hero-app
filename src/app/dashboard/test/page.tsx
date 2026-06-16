export default function TestPage() {
  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Test</h1>
      </header>

      <div className="rounded-xl border border-gray-300 bg-white p-6 shadow-lg shadow-black/10">
        <p className="text-sm text-gray-600">
          Dies ist eine neue Testseite. Hier kann Funktionalität ausprobiert werden.
        </p>
      </div>
    </div>
  );
}
