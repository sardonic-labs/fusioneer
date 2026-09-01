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
  let searchFocused = $state(false);

  const api = (p: string) => p;

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
  onMount(() => { stopPoll = startPolling(); });
  onDestroy(() => { stopPoll?.(); eventSource?.close(); });

  $effect(() => {
    if (selected) {
      logs = selected.logs ?? '';
      eventSource?.close();
      try {
        const es = new EventSource(api(`/jobs/${selected.id}/logs`));
        eventSource = es;
        es.onmessage = (e) => {
          try { const d = JSON.parse(e.data); if (d.logs) logs = d.logs; } catch {}
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

  let successCount = $derived(jobs.filter(j=>j.status==='success').length);
  let runningCount = $derived(jobs.filter(j=>j.status==='running').length);
  let queuedCount = $derived(jobs.filter(j=>j.status==='queued').length);
  let failedCount = $derived(jobs.filter(j=>j.status==='failed').length);

  function statusMeta(s: string) {
    if (s === 'success') return { bg: '#10b981', dot: '#065f46', label: 'success', icon: '✓' };
    if (s === 'failed') return { bg: '#ef4444', dot: '#7f1d1d', label: 'failed', icon: '✕' };
    if (s === 'running') return { bg: '#6366f1', dot: '#3730a3', label: 'running', icon: '◐' };
    if (s === 'queued') return { bg: '#f59e0b', dot: '#78350f', label: 'queued', icon: '◷' };
    return { bg: '#6b7280', dot: '#374151', label: s, icon: '•' };
  }

  function timeAgo(iso: string | null) {
    if (!iso) return '—';
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return `${Math.floor(diff/1000)}s`;
    if (diff < 3600000) return `${Math.floor(diff/60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h`;
    if (diff < 604800000) return `${Math.floor(diff/86400000)}d`;
    return d.toLocaleDateString();
  }
  function copyLogs() { if (logs) navigator.clipboard.writeText(logs); }
</script>

<div class="app">
  <nav class="nav">
    <div class="brand">
      <div class="logo">◈</div>
      <div>
        <div class="brand-name">fusioneer</div>
        <div class="brand-sub">home managed agents · opencode run</div>
      </div>
    </div>
    <div class="nav-right">
      <div class="health-pill" class:ok={health?.ok}>
        <span class="pulse" class:live={health?.ok}></span>
        {health?.ok ? 'live' : 'offline'}
      </div>
      <label class="switch">
        <input type="checkbox" bind:checked={autoRefresh} />
        <span class="track"><span class="thumb"></span></span>
        <span class="switch-label">auto</span>
      </label>
      <a class="nav-link" href="/health" target="_blank">API</a>
    </div>
  </nav>

  <section class="hero">
    <div class="hero-text">
      <h1>Your agents, running at home.</h1>
      <p>One Docker on your VPS. Webhook → queue → worktree → <code>opencode run</code> → draft PR. No <code>opencode serve</code>.</p>
    </div>
    <div class="hero-stats">
      <div class="hero-card"><span class="hero-num">{jobs.length}</span><span class="hero-label">jobs</span></div>
      <div class="hero-card"><span class="hero-num" style="color:#6366f1">{runningCount}</span><span class="hero-label">running</span></div>
      <div class="hero-card"><span class="hero-num" style="color:#10b981">{successCount}</span><span class="hero-label">success</span></div>
      <div class="hero-card"><span class="hero-num" style="color:#ef4444">{failedCount}</span><span class="hero-label">failed</span></div>
    </div>
  </section>

  <section class="grid">
    <div class="card">
      <div class="card-head">
        <h3>queue</h3>
        <span class="tag">{stats?.global?.concurrency ?? 2} max · {stats?.global?.pending ?? 0} pending</span>
      </div>
      {#if stats}
        <div class="queue-bars">
          <div class="bar-row"><span>global</span><div class="bar"><div class="fill" style="width: {Math.min(100, (stats.global?.pending ?? 0)*25)}%; background:#6366f1"></div></div><span class="mono">{stats.global?.pending} / {stats.global?.size}</span></div>
          <div class="running">running: {#if stats.runningRepos?.length}<span class="pill mono">{stats.runningRepos.join(', ')}</span>{:else}<span class="muted">idle</span>{/if}</div>
          {#each stats.perRepo ?? [] as r}
            <div class="bar-row small"><span class="mono">{r.repo.split('/')[1]}</span><div class="bar thin"><div class="fill" style="width: {r.pending ? 60 : 0}%; background:#f59e0b"></div></div><span class="mono">{r.pending}</span></div>
          {/each}
        </div>
      {:else}<div class="muted">loading queue…</div>{/if}
    </div>

    <div class="card">
      <div class="card-head"><h3>schedules</h3><span class="tag">cron · interval</span></div>
      {#if schedules.length === 0}
        <div class="empty">
          <div class="empty-icon">◷</div>
          <div>no active schedules</div>
          <div class="muted small">add to <code>.opencode/fusioneer.json</code> <code>schedules:[{`{cron:"0 6 * * *", enabled:true}`}]</code> + <code>FUSIONEER_ALLOW_REPOS</code></div>
        </div>
      {:else}
        <div class="sched-list">
          {#each schedules as s}
            <div class="sched"><span class="pill mono">{s.type ?? 'cron'}</span><span class="mono">{s.repo}</span><span class="mono muted">{s.schedule.cron ?? s.schedule.interval}</span></div>
          {/each}
        </div>
      {/if}
      <div class="card-foot muted">daily backup 02:00 UTC · WAL · 429 backoff</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>filter</h3><span class="tag">{filtered.length}/{jobs.length}</span></div>
      <div class="filter">
        <div class="search" class:focused={searchFocused}>
          <span class="search-icon">⌕</span>
          <input placeholder="filter repo…" bind:value={filterRepo} onfocus={() => searchFocused=true} onblur={() => searchFocused=false} />
        </div>
        <div class="pills">
          {#each ['', 'queued','running','success','failed','skipped'] as s}
            <button class="pill-btn" class:active={filterStatus===s} onclick={() => filterStatus=s}>{s || 'all'}</button>
          {/each}
        </div>
        <div class="muted small">{queuedCount} queued · {runningCount} running · {successCount} done</div>
      </div>
    </div>
  </section>

  <section class="layout">
    <div class="panel">
      <div class="panel-head">
        <h2>jobs</h2>
        <div class="panel-actions"><button class="ghost" onclick={load}>↻ refresh</button><span class="muted small">{jobs.length} total</span></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>repo & issue</th><th>status</th><th>phase</th><th>branch</th><th>age</th></tr></thead>
          <tbody>
            {#each filtered as j}
              {@const m = statusMeta(j.status)}
              <tr class:selected={selected?.id === j.id} onclick={() => selected = j}>
                <td>
                  <div class="repo">{j.repo}</div>
                  <div class="issue-title muted small">{j.issue ? `#${j.issue}` : '—'} {j.issue_title ? `· ${j.issue_title.slice(0,32)}` : ''}</div>
                </td>
                <td><span class="status"><span class="status-dot" style="background:{m.dot}; box-shadow: 0 0 0 4px {m.bg}22"></span><span class="status-pill" style="background:{m.bg}">{m.icon} {m.label}</span></span></td>
                <td><span class="phase">{j.phase ?? '—'}</span></td>
                <td class="mono small" title={j.branch ?? ''}>{j.branch ? j.branch.slice(10, 36) + '…' : '—'}</td>
                <td class="muted small">{timeAgo(j.created_at)}</td>
              </tr>
            {/each}
            {#if filtered.length === 0}
              <tr><td colspan="5"><div class="empty"><div class="empty-icon">∅</div><div>no jobs</div><div class="muted small">label an issue <code>fusioneer:auto</code> or comment <code>/fusioneer</code></div></div></td></tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel detail">
      {#if selected}
        {@const m = statusMeta(selected.status)}
        <div class="detail-head">
          <div>
            <div class="detail-title">{selected.repo}<span class="muted">#{selected.issue}</span></div>
            <div class="muted small">{selected.issue_title ?? ''}</div>
          </div>
          <button class="ghost" onclick={() => selected = null}>✕</button>
        </div>
        <div class="detail-meta">
          <span class="status-pill large" style="background:{m.bg}">{m.icon} {selected.status}</span>
          <span class="pill mono">{selected.event}</span>
          <span class="pill mono">{selected.phase}</span>
          <span class="muted small">delivery {selected.delivery_id?.slice(0,8) ?? '—'} · exit {selected.exit_code ?? '—'}</span>
        </div>
        <div class="detail-grid">
          <div><span class="muted small">branch</span><div class="mono small">{selected.branch ?? '—'}</div></div>
          <div><span class="muted small">created</span><div class="small">{timeAgo(selected.created_at)} · {timeAgo(selected.started_at)} → {timeAgo(selected.finished_at)}</div></div>
        </div>
        <div class="tabs">
          <a class="tab" href={`https://github.com/${selected.repo}/issues/${selected.issue ?? ''}`} target="_blank">↗ issue</a>
          <a class="tab" href={`https://github.com/${selected.repo}/pull/${selected.issue ?? ''}`} target="_blank">↗ PR</a>
          <button class="tab" onclick={copyLogs}>⎘ copy logs</button>
          <button class="tab" onclick={() => { if (selected) fetch(`/jobs/${selected.id}/logs`).then(r=>r.json()).then(d=>logs=d.logs); }}>↻ reload</button>
        </div>
        <div class="logs-wrap">
          <div class="logs-head"><span class="muted small">logs · {logs.length} chars · SSE live</span><span class="pulse small" class:live={selected.status==='running'}></span></div>
          <pre class="logs">{logs || 'no logs yet…'}</pre>
        </div>
      {:else}
        <div class="empty big">
          <div class="empty-icon">◈</div>
          <div style="font-weight:600;">select a job</div>
          <div class="muted">live logs via <code>/jobs/:id/logs</code> SSE</div>
          <div class="how">
            <div><b>1</b> label <code>fusioneer:auto</code></div>
            <div><b>2</b> workflow <code>POST /webhook/github</code></div>
            <div><b>3</b> SQLite queued → <code>p-queue</code> 2 global · 1 per-repo → worktree <code>opencode run</code></div>
            <div><b>4</b> draft PR <code>Closes #n</code> · <code>/fusioneer revise:</code> force-push (max 3)</div>
          </div>
        </div>
      {/if}
    </div>
  </section>

  <footer>
    <span>fusioneer v0.1.0 — hono · bun:sqlite WAL · p-queue · cron · Svelte 5</span>
    <span class="links"><a href="/health" target="_blank">health</a> · <a href="/jobs" target="_blank">jobs</a> · <a href="/queue/stats" target="_blank">queue</a> · <a href="/schedules" target="_blank">schedules</a></span>
  </footer>
</div>

<style>
  :global(*){box-sizing:border-box}
  :global(body){margin:0; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fcfcfc; color: #18181b; -webkit-font-smoothing: antialiased;}
  :global(code){font-family: ui-monospace, SFMono-Regular, monospace; background:#f4f4f5; padding:1px 4px; border-radius:4px; font-size:.82em; border:1px solid #e4e4e7;}
  .app{max-width:1280px; margin:0 auto; padding: 16px 20px 32px;}
  .nav{display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:#fff; border:1px solid #e4e4e7; border-radius:16px; box-shadow: 0 1px 2px #0000000a, 0 4px 12px #00000008;}
  .brand{display:flex; gap:12px; align-items:center;}
  .logo{width:32px; height:32px; border-radius:10px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color:#fff; display:grid; place-items:center; font-size:18px; box-shadow: 0 4px 10px #6366f122;}
  .brand-name{font-weight:700; letter-spacing:-.02em;}
  .brand-sub{font-size:11px; color:#71717a;}
  .nav-right{display:flex; gap:12px; align-items:center; font-size:13px;}
  .health-pill{display:flex; gap:6px; align-items:center; padding:6px 10px; border-radius:999px; background:#f4f4f5; border:1px solid #e4e4e7; font-weight:500;}
  .health-pill.ok{background:#ecfdf5; border-color:#a7f3d0; color:#065f46;}
  .pulse{width:8px; height:8px; border-radius:50%; background:#d4d4d8;}
  .pulse.live{background:#10b981; box-shadow: 0 0 0 0 #10b98144; animation: pulse 2s infinite;}
  @keyframes pulse{0%{box-shadow:0 0 0 0 #10b98166}70%{box-shadow:0 0 0 8px #10b98100}100%{box-shadow:0 0 0 0 #10b98100}}
  .pulse.small{width:6px; height:6px;}
  .switch{display:flex; gap:6px; align-items:center; cursor:pointer; font-size:13px; color:#71717a;}
  .switch input{appearance:none; width:28px; height:16px; background:#e4e4e7; border-radius:999px; position:relative; cursor:pointer; transition:.2s;}
  .switch input:checked{background:#6366f1;}
  .switch input::after{content:''; position:absolute; top:2px; left:2px; width:12px; height:12px; background:#fff; border-radius:50%; transition:.2s; box-shadow:0 1px 2px #0002;}
  .switch input:checked::after{transform: translateX(12px);}
  .switch-label{font-size:12px;}
  .nav-link{padding:6px 10px; border-radius:999px; border:1px solid #e4e4e7; text-decoration:none; color:#18181b; background:#fff;}
  .nav-link:hover{background:#f4f4f5;}

  .hero{margin:18px 0 14px; display:grid; grid-template-columns: 1.2fr .8fr; gap:16px; align-items:center;}
  .hero-text h1{margin:0; font-size:28px; letter-spacing:-.03em; line-height:1.1;}
  .hero-text p{margin:6px 0 0; color:#71717a; font-size:14px;}
  .hero-stats{display:grid; grid-template-columns: repeat(4,1fr); gap:10px;}
  .hero-card{background:#fff; border:1px solid #e4e4e7; border-radius:16px; padding:14px; text-align:center; box-shadow: 0 1px 2px #00000008;}
  .hero-num{font-size:22px; font-weight:700; display:block; letter-spacing:-.02em;}
  .hero-label{font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#71717a;}

  .grid{display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px; margin:12px 0;}
  .card{background:#fff; border:1px solid #e4e4e7; border-radius:16px; padding:14px; box-shadow: 0 1px 2px #00000006;}
  .card-head{display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;}
  .card-head h3{margin:0; font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#71717a;}
  .tag{font-size:11px; padding:3px 8px; border-radius:999px; background:#f4f4f5; border:1px solid #e4e4e7; color:#71717a;}
  .queue-bars{display:flex; flex-direction:column; gap:8px;}
  .bar-row{display:flex; gap:8px; align-items:center; font-size:12px;}
  .bar-row.small{font-size:11px;}
  .bar{flex:1; height:6px; background:#f4f4f5; border-radius:999px; overflow:hidden; border:1px solid #e4e4e7;}
  .bar.thin{height:4px;}
  .fill{height:100%; border-radius:999px; transition: width .6s ease;}
  .running{font-size:12px; color:#71717a;}
  .pill{background:#f4f4f5; border:1px solid #e4e4e7; padding:2px 8px; border-radius:999px; font-size:11px;}
  .empty{text-align:center; padding:16px; color:#71717a;}
  .empty-icon{font-size:22px; margin-bottom:6px; color:#a1a1aa;}
  .empty .small{font-size:11px;}
  .card-foot{margin-top:10px; padding-top:8px; border-top:1px solid #f4f4f5; font-size:11px;}
  .filter{display:flex; flex-direction:column; gap:8px;}
  .search{position:relative; display:flex; align-items:center;}
  .search-icon{position:absolute; left:10px; color:#71717a; font-size:14px; pointer-events:none;}
  .search input{width:100%; padding:8px 10px 8px 28px; border-radius:999px; border:1px solid #e4e4e7; background:#fcfcfc; outline:none; font-size:13px; transition: .15s;}
  .search.focused input{border-color:#6366f1; box-shadow: 0 0 0 3px #6366f111;}
  .pills{display:flex; gap:6px; flex-wrap:wrap;}
  .pill-btn{padding:4px 10px; border-radius:999px; border:1px solid #e4e4e7; background:#fff; font-size:11px; cursor:pointer; color:#71717a;}
  .pill-btn.active{background:#18181b; color:#fff; border-color:#18181b;}
  .pill-btn:hover{border-color:#a1a1aa;}

  .layout{display:grid; grid-template-columns: 1.15fr .85fr; gap:12px; margin-top:12px;}
  .panel{background:#fff; border:1px solid #e4e4e7; border-radius:16px; overflow:hidden; box-shadow: 0 1px 2px #00000006;}
  .panel-head{padding:12px 14px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f4f4f5;}
  .panel-head h2{margin:0; font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:#71717a;}
  .panel-actions{display:flex; gap:8px; align-items:center;}
  .ghost{background:#fff; border:1px solid #e4e4e7; padding:6px 10px; border-radius:999px; font-size:12px; cursor:pointer;}
  .ghost:hover{background:#f4f4f5;}
  .table-wrap{overflow:auto; max-height: 560px;}
  table{width:100%; border-collapse:collapse; font-size:13px;}
  th{position:sticky; top:0; background:#fcfcfc; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#71717a; padding:8px 12px; border-bottom:1px solid #e4e4e7;}
  td{padding:10px 12px; border-bottom:1px solid #f4f4f5; vertical-align:top;}
  tr{transition:.12s; cursor:pointer;}
  tr:hover{background:#fafafa;}
  tr.selected{background:#eef2ff !important;}
  .repo{font-weight:600; font-size:12px;}
  .issue-title{margin-top:2px;}
  .status{display:flex; gap:6px; align-items:center;}
  .status-dot{width:7px; height:7px; border-radius:50%;}
  .status-pill{color:#fff; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; letter-spacing:.02em;}
  .phase{font-size:11px; padding:3px 7px; border-radius:999px; background:#f4f4f5; border:1px solid #e4e4e7; color:#52525b;}
  .mono{font-family: ui-monospace, SFMono-Regular, monospace; font-size:12px;}
  .small{font-size:11px;}
  .muted{color:#71717a;}
  .detail{padding:0; display:flex; flex-direction:column;}
  .detail-head{padding:14px; display:flex; justify-content:space-between; gap:12px; border-bottom:1px solid #f4f4f5;}
  .detail-title{font-weight:700; letter-spacing:-.01em;}
  .detail-meta{padding:10px 14px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; border-bottom:1px solid #f4f4f5; background:#fafafa;}
  .status-pill.large{padding:4px 10px; font-size:12px;}
  .detail-grid{display:grid; grid-template-columns: 1fr 1fr; gap:12px; padding:10px 14px; border-bottom:1px solid #f4f4f5;}
  .tabs{display:flex; gap:8px; padding:10px 14px; border-bottom:1px solid #f4f4f5;}
  .tab{padding:6px 10px; border-radius:999px; border:1px solid #e4e4e7; background:#fff; font-size:12px; text-decoration:none; color:#18181b; cursor:pointer;}
  .tab:hover{background:#f4f4f5;}
  .logs-wrap{padding:12px; flex:1; display:flex; flex-direction:column; min-height:0;}
  .logs-head{display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;}
  .logs{margin:0; background:#18181b; color:#e4e4e7; border-radius:12px; padding:12px; max-height: 420px; overflow:auto; white-space:pre-wrap; word-break:break-all; font-size:12px; line-height:1.5; border:1px solid #27272a;}
  .how{display:grid; gap:6px; margin-top:12px; text-align:left; font-size:12px;}
  .how div{display:flex; gap:8px; align-items:center;}
  .how b{width:18px; height:18px; border-radius:50%; background:#6366f1; color:#fff; display:grid; place-items:center; font-size:11px; flex-shrink:0;}
  .empty.big{padding:32px 20px;}
  footer{margin-top:14px; display:flex; justify-content:space-between; align-items:center; padding:12px 4px; font-size:12px; color:#71717a; border-top:1px solid #e4e4e7;}
  footer a{color:#6366f1; text-decoration:none;}
  footer a:hover{text-decoration:underline;}
  .links{display:flex; gap:8px;}
  @media (max-width: 960px){ .hero{grid-template-columns:1fr} .hero-stats{grid-template-columns: repeat(4,1fr)} .grid{grid-template-columns:1fr} .layout{grid-template-columns:1fr} .hero-stats{grid-template-columns: repeat(2,1fr)} }
</style>
