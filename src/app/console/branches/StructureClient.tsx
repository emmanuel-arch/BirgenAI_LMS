"use client";

// The org chart, and the thing that builds it.
//
// A lender starts with nothing, so this screen starts by asking for ONE thing: the
// head office. Everything else hangs off it, and the levels are the lender's own words
// — "Region", "Zone", "Outlet" — because a system that insists on our vocabulary is a
// system they have to translate their own company into.
//
// The tree shows people and money per node, not just names. The reason a regional
// manager opens an org chart is to see where the book actually is.
import { useState } from "react";
import { Building2, Plus, Loader2, AlertCircle, Users, Landmark, Trash2, Pencil, X, Check, ChevronRight } from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";

type Node = {
  id: string;
  name: string;
  parentId: string | null;
  levelName: string;
  code: string | null;
  active: boolean;
  disbursementLimit: number | null;
  staff: number;
  borrowers: number;
  olb: number;
  loans: number;
};

const kes = (n: number) =>
  n >= 1_000_000 ? `KES ${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `KES ${Math.round(n / 1_000)}K` : `KES ${Math.round(n)}`;

/** Suggested next level down — a hint, never a rule. The lender can type anything. */
const NEXT_LEVEL: Record<string, string> = {
  "Head Office": "Region",
  Region: "Branch",
  Branch: "Sub-branch",
  "Sub-branch": "Unit",
};

export function StructureClient() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/console/branches");
    const data = await res.json();
    if (!data.success) throw new Error(data.message ?? "Could not load the structure.");
    setNodes(data.branches);
    setCanManage(data.canManage);
  };

  useLoad(async () => {
    try { await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load the structure."); }
    finally { setLoading(false); }
  });

  const call = async (method: "POST" | "PUT" | "DELETE", body?: unknown, query?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/console/branches${query ?? ""}`, {
        method,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message ?? "That didn't work.");
      await load();
      setAddingUnder(null);
      setEditing(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const root = nodes.find((n) => n.parentId === null) ?? null;
  const childrenOf = (id: string) => nodes.filter((n) => n.parentId === id);

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading your structure…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-900">
          <Building2 className="h-6 w-6" style={{ color: "var(--brand)" }} /> Organisation Structure
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-zinc-500">
          Your head office, regions, branches and units. Every staff member, borrower and loan belongs to one of these —
          and it is what decides who sees whose book. A branch manager sees their branch; a regional manager sees
          everything under their region; an officer sees only their own customers.
        </p>
      </header>

      {error && (
        <p className="mt-5 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {!root ? (
        <FirstOffice canManage={canManage} busy={busy} onCreate={(name, levelName) => call("POST", { name, levelName })} />
      ) : (
        <div className="mt-6 space-y-2">
          <TreeNode
            node={root}
            depth={0}
            nodes={nodes}
            childrenOf={childrenOf}
            canManage={canManage}
            busy={busy}
            addingUnder={addingUnder}
            editing={editing}
            setAddingUnder={setAddingUnder}
            setEditing={setEditing}
            call={call}
          />
        </div>
      )}

      {root && canManage && (
        <p className="mt-6 text-[12px] leading-relaxed text-zinc-400">
          Add a region or a branch with the <Plus className="inline h-3 w-3" /> on any office. An office can&apos;t be deleted
          while staff, borrowers or loans still belong to it — move them first, or switch it off.
        </p>
      )}
    </main>
  );
}

function FirstOffice({ canManage, busy, onCreate }: { canManage: boolean; busy: boolean; onCreate: (name: string, levelName: string) => void }) {
  const [name, setName] = useState("Head Office");

  if (!canManage) {
    return (
      <p className="mt-6 rounded-xl border border-zinc-900/10 bg-white/60 px-4 py-8 text-center text-sm text-zinc-500">
        Your organisation structure hasn&apos;t been set up yet. An administrator needs to create the head office.
      </p>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-zinc-900/10 bg-white/70 p-6">
      <h2 className="text-base font-semibold text-zinc-900">Start with your head office</h2>
      <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-zinc-500">
        This is the top of your organisation. Everything else — regions, branches, units — hangs off it, and you can name
        the levels whatever your company actually calls them.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Head Office"
          className="w-64 rounded-lg border border-zinc-900/15 bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--brand)]"
        />
        <button
          disabled={busy || !name.trim()}
          onClick={() => onCreate(name.trim(), "Head Office")}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: "var(--brand)" }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Create head office
        </button>
      </div>
    </div>
  );
}

function TreeNode({
  node, depth, nodes, childrenOf, canManage, busy, addingUnder, editing, setAddingUnder, setEditing, call,
}: {
  node: Node;
  depth: number;
  nodes: Node[];
  childrenOf: (id: string) => Node[];
  canManage: boolean;
  busy: boolean;
  addingUnder: string | null;
  editing: string | null;
  setAddingUnder: (id: string | null) => void;
  setEditing: (id: string | null) => void;
  call: (m: "POST" | "PUT" | "DELETE", body?: unknown, query?: string) => Promise<boolean>;
}) {
  const kids = childrenOf(node.id);
  const isRoot = node.parentId === null;

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 20 }}>
      <div className={`rounded-xl border bg-white/70 px-3.5 py-3 ${node.active ? "border-zinc-900/10" : "border-zinc-900/10 opacity-55"}`}>
        <div className="flex flex-wrap items-center gap-2">
          {depth > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold text-zinc-900">{node.name}</span>
              <span className="rounded-full bg-zinc-900/5 px-2 py-0.5 text-[10px] font-medium text-zinc-500">{node.levelName}</span>
              {node.code && <span className="text-[11px] text-zinc-400">{node.code}</span>}
              {!node.active && <span className="rounded-full bg-zinc-900/5 px-2 py-0.5 text-[10px] font-medium text-zinc-500">Switched off</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {node.staff} staff</span>
              <span className="flex items-center gap-1"><Landmark className="h-3 w-3" /> {node.loans} loans · {kes(node.olb)}</span>
              <span>{node.borrowers} borrowers</span>
            </div>
          </div>

          {canManage && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => setAddingUnder(addingUnder === node.id ? null : node.id)}
                title="Add an office under this one"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={() => setEditing(editing === node.id ? null : node.id)}
                title="Rename"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900"
              >
                {editing === node.id ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
              </button>
              {!isRoot && (
                <button
                  disabled={busy}
                  onClick={() => call("DELETE", undefined, `?id=${node.id}`)}
                  title="Delete"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {editing === node.id && <EditRow node={node} nodes={nodes} busy={busy} call={call} />}
        {addingUnder === node.id && <AddRow parent={node} busy={busy} call={call} />}
      </div>

      {kids.length > 0 && (
        <div className="mt-2 space-y-2 border-l border-zinc-900/10 pl-2">
          {kids.map((k) => (
            <TreeNode
              key={k.id} node={k} depth={depth + 1} nodes={nodes} childrenOf={childrenOf}
              canManage={canManage} busy={busy} addingUnder={addingUnder} editing={editing}
              setAddingUnder={setAddingUnder} setEditing={setEditing} call={call}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddRow({ parent, busy, call }: { parent: Node; busy: boolean; call: (m: "POST", body: unknown) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [levelName, setLevelName] = useState(NEXT_LEVEL[parent.levelName] ?? "Branch");
  const [code, setCode] = useState("");

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-zinc-900/10 bg-zinc-900/[0.02] p-2.5">
      <Field label={`New office under ${parent.name}`}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nairobi CBD" autoFocus
          className="w-48 rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[color:var(--brand)]" />
      </Field>
      <Field label="What you call this level">
        <input value={levelName} onChange={(e) => setLevelName(e.target.value)} placeholder="Branch"
          className="w-32 rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[color:var(--brand)]" />
      </Field>
      <Field label="Code">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="NRB-CBD"
          className="w-28 rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[color:var(--brand)]" />
      </Field>
      <button
        disabled={busy || !name.trim()}
        onClick={() => call("POST", { name: name.trim(), parentId: parent.id, levelName: levelName.trim(), code: code.trim() || null })}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        style={{ backgroundColor: "var(--brand)" }}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
      </button>
    </div>
  );
}

function EditRow({ node, nodes, busy, call }: { node: Node; nodes: Node[]; busy: boolean; call: (m: "PUT", body: unknown) => Promise<boolean> }) {
  const [name, setName] = useState(node.name);
  const [levelName, setLevelName] = useState(node.levelName);
  const [parentId, setParentId] = useState(node.parentId ?? "");
  const isRoot = node.parentId === null;

  // A node may not be moved under itself or its own descendants — the server refuses it
  // too, but offering the choice and then rejecting it is a worse way to say so.
  const descendants = new Set<string>();
  const walk = (id: string) => {
    descendants.add(id);
    for (const n of nodes.filter((x) => x.parentId === id)) walk(n.id);
  };
  walk(node.id);
  const parentOptions = nodes.filter((n) => !descendants.has(n.id));

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-zinc-900/10 bg-zinc-900/[0.02] p-2.5">
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="w-48 rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[color:var(--brand)]" />
      </Field>
      <Field label="Level">
        <input value={levelName} onChange={(e) => setLevelName(e.target.value)}
          className="w-32 rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[color:var(--brand)]" />
      </Field>
      {!isRoot && (
        <Field label="Reports to">
          <select value={parentId} onChange={(e) => setParentId(e.target.value)}
            className="w-44 rounded-lg border border-zinc-900/15 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-[color:var(--brand)]">
            {parentOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      <button
        disabled={busy || !name.trim()}
        onClick={() => call("PUT", { id: node.id, name: name.trim(), levelName: levelName.trim(), ...(isRoot ? {} : { parentId }) })}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        style={{ backgroundColor: "var(--brand)" }}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
      </button>
      {!isRoot && (
        <button
          disabled={busy}
          onClick={() => call("PUT", { id: node.id, active: !node.active })}
          className="rounded-lg border border-zinc-900/12 bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
        >
          {node.active ? "Switch off" : "Switch on"}
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-zinc-500">{label}</label>
      {children}
    </div>
  );
}
