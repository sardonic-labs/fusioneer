<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  type Job = {
    id: string;
    delivery_id: string | null;
    repo: string;
    event: string;
    issue: number | null;
    issue_title: string | null;
    status: 'queued' | 'running' | 'success' | 'failed' | 'skipped';
    phase: string | null;
    branch: string | null;
    logs: string | null;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    exit_code: number | null;
  };

  let jobs: Job[] = $state([]);
  let stats: any = $state(null);
  let schedules: any[] = $state([]);
  let health: any = $state(null);
  let selected: Job | null = $state(null);
  let logs = $state('');
  let filterRepo = $state('');
  let filterStatus = $state('');
  let autoRefresh = $state(true);
  let eventSource: EventSource | null = null;

  const api = (p: string) => p; // proxied in dev, same origin in prod

  async function load() {
    try {
      const [j, q, s, h] = await Promise.all([
        fetch(api('/jobs?limit=50')).then(r => r.json()),
        fetch(api('/queue/stats')).then(r => r.json()).catch(() => null),
        fetch(api('/schedules')).then(r => r.json()).catch(() => ({ schedules: [] })),
        fetch(api('/health')).then(r => r.json()).catch(() => null),
      ]);
      jobs = j.jobs ?? [];
      stats = q;
      schedules = s.schedules ?? [];
      health = h;
    } catch (e) {
      console.warn(e);
    }
  }

  function startPolling() {
    load();
    const id = setInterval(() => { if (autoRefresh) load(); }, 2000);
    return () => clearInterval(id);
  }

  let stopPoll: (() => void) | null = null;
  onMount(() => {
    stopPoll = startPolling();
  });
  onDestroy(() => {
    stopPoll?.();
    eventSource?.close();
  });

  $effect(() => {
    if (selected) {
      logs = selected.logs ?? '';
      eventSource?.close();
      // SSE live tail
      try {
        const es = new EventSource(api(`/jobs/${selected.id}/logs`));
        eventSource = es;
        es.onmessage = (e) => {
          try {
            const d = JSON.parse(e.data);
            if (d.logs) logs = d.logs;
          } catch {}
        };
        es.addEventListener('done', () => es.close());
        es.onerror = () => es.close();
      } catch {}
    } else {
      eventSource?.close();
      eventSource = null;
    }
  });

  let filtered = $derived(
    jobs.filter(j => {
      if (filterRepo && !j.repo.toLowerCase().includes(filterRepo.toLowerCase())) return false;
      if (filterStatus && j.status !== filterStatus) return false;
      return true;
    })
  );

  function statusColor(s: string) {
    if (s === 'success') return '#0a0';
    if (s === 'failed') return '#d73a4a';
    if (s === 'running') return '#1f6feb';
    if (s === 'queued') return '#9a6700';
    return '#8b949e';
  }

  function timeAgo(iso: string | null) {
    if (!iso) return '-';
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return `${Math.floor(diff/1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
    return d.toLocaleString();
  }
</script>

<main>
  <header>
    <h1>fusioneer <span class="sub">home managed agents</span></h1>
    <div class="health">
      {#if health?.ok}<span class="dot ok"></span> ok{:else}<span class="dot bad"></span> down{/if}
      <label><input type="checkbox" bind:checked={autoRefresh} /> auto</label>
    </div>
  </header>

  <section class="stats">
    <div class="card">
      <h3>queue</h3>
      {#if stats}
        <div>global {stats.global?.pending} pending / {stats.global?.size} queued (max {stats.global?.concurrency})</div>
        <div>running: {stats.runningRepos?.join(', ') || '-'}</div>
        {#each stats.perRepo ?? [] as r}
          <div class="mono">{r.repo}: {r.pending} pending {r.size} queued</div>
        {/each}
      {:else}loading{/if}
    </div>
    <div class="card">
      <h3>schedules</h3>
      {#if schedules.length === 0}<div class="muted">no active cron/interval (set FUSIONEER_ALLOW_REPOS + .opencode/fusioneer.json schedules enabled)</div>
      {:else}
        {#each schedules as s}
          <div class="mono">{s.repo} {s.type}: {s.schedule.cron ?? s.schedule.interval} {s.schedule.prompt?.slice(0,40) ?? ''}</div>
        {/each}
      {/if}
      <div class="muted">backup 0 2 * * * daily WAL</div>
    </div>
    <div class="card">
      <h3>filters</h3>
      <input placeholder="repo filter" bind:value={filterRepo} />
      <select bind:value={filterStatus}>
        <option value="">all status</option>
        <option value="queued">queued</option>
        <option value="running">running</option>
        <option value="success">success</option>
        <option value="failed">failed</option>
        <option value="skipped">skipped</option>
      </select>
      <div class="muted">{filtered.length}/{jobs.length} jobs</div>
    </div>
  </section>

  <section class="layout">
    <div class="jobs">
      <h2>jobs <button onclick={load}>refresh</button></h2>
      <table>
        <thead><tr><th>repo</th><th>issue</th><th>status</th><th>phase</th><th>branch</th><th>created</th></tr></thead>
        <tbody>
          {#each filtered as j}
            <tr class:selected={selected?.id === j.id} onclick={() => selected = j}>
              <td class="mono">{j.repo}</td>
              <td>{j.issue ?? '-'}</td>
              <td><span class="badge" style:background={statusColor(j.status)}>{j.status}</span></td>
              <td>{j.phase ?? '-'}</td>
              <td class="mono" title={j.branch ?? ''}>{j.branch?.slice(0, 28) ?? '-'}</td>
              <td>{timeAgo(j.created_at)}</td>
            </tr>
          {/each}
          {#if filtered.length === 0}<tr><td colspan="6" class="muted">no jobs</td></tr>{/if}
        </tbody>
      </table>
    </div>

    <div class="detail">
      {#if selected}
        <h2>{selected.repo}#{selected.issue} <span class="muted">{selected.issue_title ?? ''}</span></h2>
        <div class="meta">
          <span class="badge" style:background={statusColor(selected.status)}>{selected.status}</span>
          {selected.phase} · {selected.event} · delivery {selected.delivery_id?.slice(0,8) ?? '-'} · exit {selected.exit_code ?? '-'}
          <div class="mono">branch {selected.branch ?? '-'}</div>
          <div>{timeAgo(selected.started_at)} → {timeAgo(selected.finished_at)}</div>
        </div>
        <div class="actions">
          <a href={`https://github.com/${selected.repo}/pull/${selected.issue ?? ''}`} target="_blank" rel="noreferrer">open PR/issue</a>
          <button onclick={() => { if (selected) { fetch(api(`/jobs/${selected.id}/logs`)).then(r=>r.json()).then(d=>logs=d.logs); } }}>reload logs</button>
          <button onclick={() => selected = null}>close</button>
        </div>
        <pre class="logs">{logs || 'no logs'}</pre>
      {:else}
        <div class="muted" style="padding: 2rem;">select a job to view logs (SSE live)</div>
        <div class="card">
          <h3>how it works</h3>
          <div class="mono">label issue fusioneer:auto → workflow POST /webhook/github → SQLite queued → p-queue (2 global, 1 per-repo) → worktree opencode run triage→plan→implement→verify→pr → draft PR Closes #n · revision /fusioneer</div>
          <div class="mono">schedules: .opencode/fusioneer.json schedules[].cron / interval (6h) → /schedules</div>
          <div class="mono">structured: FUSIONEER_STRUCTURED=1 → createOpencode() Zod Triage/Plan schemas</div>
        </div>
      {/if}
    </div>
  </section>

  <footer>
    <span class="muted">fusioneer v0.1.0 — hono + bun:sqlite WAL + p-queue — <a href="/health" target="_blank">/health</a> · <a href="/jobs" target="_blank">/jobs</a> · <a href="/queue/stats" target="_blank">/queue/stats</a> · <a href="/structured/schemas" target="_blank">/structured/schemas</a></span>
  </footer>
</main>

<style>
  :global(body) { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif; margin: 0; background: #0d1117; color: #c9d1d9; }
  main { max-width: 1280px; margin: 0 auto; padding: 1rem; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #21262d; padding-bottom: .5rem; }
  h1 { margin: 0; font-size: 1.4rem; } .sub { font-weight: 400; color: #8b949e; font-size: .9rem; }
  .health { display:flex; gap:.75rem; align-items:center; } .dot { width:8px; height:8px; border-radius:50%; display:inline-block; } .dot.ok{background:#2da44e} .dot.bad{background:#d73a4a}
  .stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: .75rem; margin: .75rem 0; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: .6rem .75rem; }
  .card h3 { margin: 0 0 .35rem 0; font-size: .85rem; color: #8b949e; text-transform: uppercase; letter-spacing:.04em;}
  .muted { color: #8b949e; font-size:.8rem;}
  .mono { font-family: ui-monospace, SFMono-Regular, monospace; font-size:.82rem; word-break: break-all;}
  input, select { background: #0d1117; color: #c9d1d9; border:1px solid #30363d; border-radius:6px; padding:.3rem .4rem; width:100%; margin:.2rem 0;}
  .layout { display:grid; grid-template-columns: 1.05fr .95fr; gap:.75rem; }
  .jobs table { width:100%; border-collapse: collapse; font-size:.82rem;}
  .jobs th { text-align:left; color:#8b949e; font-weight:600; border-bottom:1px solid #30363d; padding:.3rem .4rem;}
  .jobs td { padding:.3rem .4rem; border-bottom:1px solid #21262d; }
  .jobs tr { cursor: pointer; } .jobs tr.selected { background:#1f6feb22; } .jobs tr:hover{ background:#21262d;}
  .badge { color:#fff; padding:1px 6px; border-radius:10px; font-size:.75rem; }
  .detail { background:#161b22; border:1px solid #30363d; border-radius:6px; padding:.6rem .75rem; min-height: 420px; }
  .detail h2 { margin:.2rem 0; font-size:1rem; }
  .meta { font-size:.8rem; color:#8b949e; margin:.3rem 0;}
  .actions { display:flex; gap:.5rem; margin:.4rem 0;}
  button, a { background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:6px; padding:.25rem .5rem; font-size:.8rem; cursor:pointer; text-decoration:none;}
  button:hover, a:hover { background:#30363d;}
  .logs { background:#0d1117; border:1px solid #30363d; border-radius:6px; padding:.5rem; max-height: 520px; overflow:auto; white-space:pre-wrap; word-break:break-all; font-size:.78rem;}
  footer { margin-top:1rem; border-top:1px solid #21262d; padding-top:.5rem; text-align:center;}
  @media (max-width: 900px){ .stats{grid-template-columns:1fr} .layout{grid-template-columns:1fr} }
</style>
