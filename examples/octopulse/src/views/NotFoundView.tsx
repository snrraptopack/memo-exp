/**
 * 404 Not Found View (`/*`)
 * 
 * Demonstrates:
 * 1. Catch-all routing destination (`route="/*"`)
 * 2. Declarative navigation back to the root application
 */

export function NotFoundView() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-24 text-center space-y-6">
      <div className="w-16 h-16 rounded-3xl bg-rose-950/60 border border-rose-800/60 text-rose-400 flex items-center justify-center text-2xl mx-auto shadow-xl">
        404
      </div>
      
      <div className="space-y-2">
        <h1 className="text-3xl font-extrabold text-stone-100 tracking-tight">
          Route Not Found
        </h1>
        <p className="text-sm text-stone-400 max-w-md mx-auto">
          The requested system pathway does not exist or has been relocated within the service grid.
        </p>
      </div>

      <div>
        <a
          route-to="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-stone-950 font-bold text-sm shadow-lg shadow-emerald-950 transition-all"
        >
          <span>⚡</span> Return to Dashboard
        </a>
      </div>
    </main>
  );
}
