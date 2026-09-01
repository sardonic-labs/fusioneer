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
    if (s === 'success') return { bg: 'linear-gradient(135deg,#10b981,#059669)', dot: '#065f46', label: 'success', icon: '✓' };
    if (s === 'failed') return { bg: 'linear-gradient(135deg,#ef4444,#dc2626)', dot: '#7f1d1d', label: 'failed', icon: '✕' };
    if (s === 'running') return { bg: 'linear-gradient(135deg,#6366f1,#8b5cf6)', dot: '#3730a3', label: 'running', icon: '◐' };
    if (s === 'queued') return { bg: 'linear-gradient(135deg,#f59e0b,#d97706)', dot: '#78350f', label: 'queued', icon: '◷' };
    return { bg: 'linear-gradient(135deg,#6b7280,#4b5563)', dot: '#374151', label: s, icon: '•' };
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

<div class="tahoe">
  <div class="wallpaper"></div>
  <div class="vibrancy"></div>

  <nav class="menubar glass">
    <div class="traffic">
      <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
    </div>
    <div class="brand">
      <div class="logo">◈</div>
      <div>
        <div class="brand-name">fusioneer</div>
        <div class="brand-sub">Tahoe · liquid glass · home agents</div>
      </div>
    </div>
    <div class="menubar-right">
      <div class="health-pill glass" class:ok={health?.ok}>
        <span class="pulse" class:live={health?.ok}></span>
        {health?.ok ? 'live' : 'offline'}
      </div>
      <label class="switch glass">
        <input type="checkbox" bind:checked={autoRefresh} />
        <span class="track"><span class="thumb"></span></span>
        <span class="switch-label">auto</span>
      </label>
      <a class="menubar-link glass" href="/health" target="_blank">API</a>
    </div>
  </nav>

  <section class="hero glass">
    <div class="hero-glow"></div>
    <div class="hero-content">
      <div class="hero-text">
        <h1>Your agents,<br><span class="gradient">running at home.</span></h1>
        <p>One Docker on your VPS. <code>webhook</code> → <code>queue</code> → <code>worktree</code> → <code>opencode run</code> → draft PR. Liquid glass, depth, vibrancy.</p>
      </div>
      <div class="hero-stats">
        <div class="hero-card glass"><span class="hero-num">{jobs.length}</span><span class="hero-label">jobs</span></div>
        <div class="hero-card glass"><span class="hero-num" style="color:#6366f1">{runningCount}</span><span class="hero-label">running</span></div>
        <div class="hero-card glass"><span class="hero-num" style="color:#10b981">{successCount}</span><span class="hero-label">success</span></div>
        <div class="hero-card glass"><span class="hero-num" style="color:#ef4444">{failedCount}</span><span class="hero-label">failed</span></div>
      </div>
    </div>
  </section>

  <section class="grid">
    <div class="card glass">
      <div class="card-head">
        <h3>queue</h3>
        <span class="tag glass">{stats?.global?.concurrency ?? 2} max · {stats?.global?.pending ?? 0} pending</span>
      </div>
      {#if stats}
        <div class="queue-bars">
          <div class="bar-row"><span>global</span><div class="bar glass"><div class="fill" style="width: {Math.min(100, (stats.global?.pending ?? 0)*25)}%; background:linear-gradient(90deg,#6366f1,#8b5cf6)"></div></div><span class="mono">{stats.global?.pending} / {stats.global?.size}</span></div>
          <div class="running">running: {#if stats.runningRepos?.length}<span class="pill glass mono">{stats.runningRepos.join(', ')}</span>{:else}<span class="muted">idle</span>{/if}</div>
          {#each stats.perRepo ?? [] as r}
            <div class="bar-row small"><span class="mono">{r.repo.split('/')[1]}</span><div class="bar thin glass"><div class="fill" style="width: {r.pending ? 60 : 0}%; background:linear-gradient(90deg,#f59e0b,#f97316)"></div></div><span class="mono">{r.pending}</span></div>
          {/each}
        </div>
      {:else}<div class="muted">loading queue…</div>{/if}
    </div>

    <div class="card glass">
      <div class="card-head"><h3>schedules</h3><span class="tag glass">cron · interval</span></div>
      {#if schedules.length === 0}
        <div class="empty">
          <div class="empty-icon">◷</div>
          <div>no active schedules</div>
          <div class="muted small">add <code>.opencode/fusioneer.json</code> <code>schedules:[{`{cron:"0 6 * * *", enabled:true}`}]</code></div>
        </div>
      {:else}
        <div class="sched-list">
          {#each schedules as s}
            <div class="sched glass"><span class="pill mono glass">{s.type ?? 'cron'}</span><span class="mono">{s.repo}</span><span class="mono muted">{s.schedule.cron ?? s.schedule.interval}</span></div>
          {/each}
        </div>
      {/if}
      <div class="card-foot muted">daily backup 02:00 UTC · WAL · 429 backoff</div>
    </div>

    <div class="card glass">
      <div class="card-head"><h3>filter</h3><span class="tag glass">{filtered.length}/{jobs.length}</span></div>
      <div class="filter">
        <div class="search glass" class:focused={searchFocused}>
          <span class="search-icon">⌕</span>
          <input placeholder="filter repo…" bind:value={filterRepo} onfocus={() => searchFocused=true} onblur={() => searchFocused=false} />
        </div>
        <div class="pills">
          {#each ['', 'queued','running','success','failed','skipped'] as s}
            <button class="pill-btn glass" class:active={filterStatus===s} onclick={() => filterStatus=s}>{s || 'all'}</button>
          {/each}
        </div>
        <div class="muted small">{queuedCount} queued · {runningCount} running · {successCount} done</div>
      </div>
    </div>
  </section>

  <section class="layout">
    <div class="panel glass">
      <div class="panel-head">
        <h2>jobs</h2>
        <div class="panel-actions"><button class="ghost glass" onclick={load}>↻ refresh</button><span class="muted small">{jobs.length} total</span></div>
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
                <td><span class="phase glass">{j.phase ?? '—'}</span></td>
                <td class="mono small" title={j.branch ?? ''}>{j.branch ? j.branch.slice(10, 36) + '…' : '—'}</td>
                <td class="muted small">{timeAgo(j.created_at)}</td>
              </tr>
            {/each}
            {#if filtered.length === 0}
              <tr><td colspan="5"><div class="empty"><div class="empty-icon">∅</div><div>no jobs</div><div class="muted small">label <code>fusioneer:auto</code> or comment <code>/fusioneer</code></div></div></td></tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel glass detail">
      {#if selected}
        {@const m = statusMeta(selected.status)}
        <div class="detail-head">
          <div>
            <div class="detail-title">{selected.repo}<span class="muted">#{selected.issue}</span></div>
            <div class="muted small">{selected.issue_title ?? ''}</div>
          </div>
          <button class="ghost glass" onclick={() => selected = null}>✕</button>
        </div>
        <div class="detail-meta">
          <span class="status-pill large" style="background:{m.bg}">{m.icon} {selected.status}</span>
          <span class="pill glass mono">{selected.event}</span>
          <span class="pill glass mono">{selected.phase}</span>
          <span class="muted small">delivery {selected.delivery_id?.slice(0,8) ?? '—'} · exit {selected.exit_code ?? '—'}</span>
        </div>
        <div class="detail-grid">
          <div><span class="muted small">branch</span><div class="mono small">{selected.branch ?? '—'}</div></div>
          <div><span class="muted small">created</span><div class="small">{timeAgo(selected.created_at)} · {timeAgo(selected.started_at)} → {timeAgo(selected.finished_at)}</div></div>
        </div>
        <div class="tabs">
          <a class="tab glass" href={`https://github.com/${selected.repo}/issues/${selected.issue ?? ''}`} target="_blank">↗ issue</a>
          <a class="tab glass" href={`https://github.com/${selected.repo}/pull/${selected.issue ?? ''}`} target="_blank">↗ PR</a>
          <button class="tab glass" onclick={copyLogs}>⎘ copy logs</button>
          <button class="tab glass" onclick={() => { if (selected) fetch(`/jobs/${selected.id}/logs`).then(r=>r.json()).then(d=>logs=d.logs); }}>↻ reload</button>
        </div>
        <div class="logs-wrap">
          <div class="logs-head"><span class="muted small">logs · {logs.length} chars · SSE live</span><span class="pulse small" class:live={selected.status==='running'}></span></div>
          <pre class="logs">{logs || 'no logs yet…'}</pre>
        </div>
      {:else}
        <div class="empty big">
          <div class="empty-icon">◈</div>
          <div style="font-weight:600; font-size:16px;">select a job</div>
          <div class="muted">live logs via <code>/jobs/:id/logs</code> SSE · liquid glass depth</div>
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

  <footer class="glass">
    <span>fusioneer Tahoe · liquid glass · hono · bun:sqlite WAL · Svelte 5</span>
    <span class="links"><a href="/health" target="_blank">health</a> · <a href="/jobs" target="_blank">jobs</a> · <a href="/queue/stats" target="_blank">queue</a> · <a href="/schedules" target="_blank">schedules</a></span>
  </footer>
</div>

<style>
  :global(*){box-sizing:border-box}
  :global(body){
    margin:0;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, sans-serif;
    background: #f5f5f7;
    color: #1d1d1f;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }
  :global(code){font-family: ui-monospace, SFMono-Regular, monospace; background: rgba(255,255,255,0.7); padding:1px 6px; border-radius:6px; font-size:.82em; border:1px solid rgba(0,0,0,0.06); backdrop-filter: blur(8px);}
  .tahoe{position:relative; min-height:100vh; max-width:1280px; margin:0 auto; padding: 18px 20px 32px;}
  .wallpaper{
    position: fixed; inset:0; z-index:-2;
    background:
      radial-gradient(1200px 600px at 10% -10%, #a5b4fc 0%, transparent 50%),
      radial-gradient(1000px 500px at 90% 0%, #f0abfc 0%, transparent 50%),
      radial-gradient(800px 600px at 50% 120%, #93c5fd 0%, transparent 50%),
      linear-gradient(180deg, #fbfbfd 0%, #f5f5f7 40%, #e8eaf0 100%);
    filter: saturate(1.1);
  }
  .vibrancy{
    position: fixed; inset:0; z-index:-1;
    background: linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 30%);
    backdrop-filter: blur(0.5px);
  }
  .glass{
    background: rgba(255,255,255,0.68);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border: 1px solid rgba(255,255,255,0.6);
    box-shadow: 0 8px 32px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8);
  }
  .menubar{
    display:flex; justify-content:space-between; align-items:center;
    padding:10px 14px; border-radius:16px;
  }
  .traffic{display:flex; gap:6px; align-items:center;}
  .traffic .dot{width:12px; height:12px; border-radius:50%; border:1px solid rgba(0,0,0,0.08); box-shadow: inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 2px rgba(0,0,0,0.08);}
  .traffic .red{background: #ff5f57;} .traffic .yellow{background:#febb2e;} .traffic .green{background:#28c840;}
  .brand{display:flex; gap:12px; align-items:center;}
  .logo{width:32px; height:32px; border-radius:10px; background: linear-gradient(135deg, #6366f1, #8b5cf6, #ec4899); color:#fff; display:grid; place-items:center; font-size:16px; box-shadow: 0 4px 16px #6366f133, inset 0 1px 0 rgba(255,255,255,0.5);}
  .brand-name{font-weight:700; letter-spacing:-.02em; font-size:15px;}
  .brand-sub{font-size:11px; color:#6e6e73;}
  .menubar-right{display:flex; gap:10px; align-items:center; font-size:13px;}
  .health-pill{display:flex; gap:6px; align-items:center; padding:6px 12px; border-radius:999px; font-weight:500; font-size:12px;}
  .health-pill.ok{background: rgba(236,253,245,0.8); border-color: rgba(167,243,208,0.6); color:#065f46;}
  .pulse{width:8px; height:8px; border-radius:50%; background:#d4d4d8;}
  .pulse.live{background:#10b981; box-shadow: 0 0 0 0 #10b98144; animation: pulse 2s infinite;}
  @keyframes pulse{0%{box-shadow:0 0 0 0 #10b98166}70%{box-shadow:0 0 0 8px #10b98100}100%{box-shadow:0 0 0 0 #10b98100}}
  .pulse.small{width:6px; height:6px;}
  .switch{display:flex; gap:6px; align-items:center; cursor:pointer; font-size:12px; color:#6e6e73; padding:4px 8px; border-radius:999px;}
  .switch input{appearance:none; width:28px; height:16px; background:rgba(0,0,0,0.08); border-radius:999px; position:relative; cursor:pointer; transition:.2s; border:1px solid rgba(0,0,0,0.06);}
  .switch input:checked{background:#6366f1;}
  .switch input::after{content:''; position:absolute; top:1px; left:1px; width:12px; height:12px; background:#fff; border-radius:50%; transition:.2s; box-shadow:0 1px 3px #0002;}
  .switch input:checked::after{transform: translateX(12px);}
  .menubar-link{padding:6px 12px; border-radius:999px; text-decoration:none; color:#1d1d1f; font-size:12px; font-weight:500;}
  .menubar-link:hover{background: rgba(255,255,255,0.9);}

  .hero{
    margin:16px 0 14px; border-radius:24px; padding:22px 20px; position:relative; overflow:hidden;
  }
  .hero-glow{
    position:absolute; inset:0; background:
      radial-gradient(600px 300px at 20% 0%, rgba(99,102,241,0.12) 0%, transparent 60%),
      radial-gradient(500px 300px at 90% 20%, rgba(236,72,153,0.10) 0%, transparent 60%);
    pointer-events:none;
  }
  .hero-content{position:relative; display:grid; grid-template-columns: 1.2fr .8fr; gap:16px; align-items:center;}
  .hero-text h1{margin:0; font-size:30px; letter-spacing:-.04em; line-height:1.05; font-weight:700;}
  .gradient{background: linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#ec4899 100%); -webkit-background-clip:text; -webkit-text-fill-color: transparent; background-clip:text;}
  .hero-text p{margin:8px 0 0; color:#6e6e73; font-size:14px; line-height:1.5;}
  .hero-stats{display:grid; grid-template-columns: repeat(4,1fr); gap:10px;}
  .hero-card{border-radius:16px; padding:14px; text-align:center;}
  .hero-num{font-size:24px; font-weight:700; display:block; letter-spacing:-.03em;}
  .hero-label{font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#6e6e73; font-weight:600;}

  .grid{display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px; margin:12px 0;}
  .card{border-radius:20px; padding:14px;}
  .card-head{display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;}
  .card-head h3{margin:0; font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#6e6e73; font-weight:600;}
  .tag{font-size:11px; padding:4px 10px; border-radius:999px; font-weight:500;}
  .queue-bars{display:flex; flex-direction:column; gap:8px;}
  .bar-row{display:flex; gap:8px; align-items:center; font-size:12px;}
  .bar-row.small{font-size:11px;}
  .bar{flex:1; height:6px; background: rgba(0,0,0,0.06); border-radius:999px; overflow:hidden; border:1px solid rgba(255,255,255,0.5);}
  .bar.thin{height:4px;}
  .fill{height:100%; border-radius:999px; transition: width .6s ease; box-shadow: inset 0 1px 0 rgba(255,255,255,0.5);}
  .running{font-size:12px; color:#6e6e73;}
  .pill{padding:2px 10px; border-radius:999px; font-size:11px; font-weight:500;}
  .empty{text-align:center; padding:20px; color:#6e6e73;}
  .empty-icon{font-size:24px; margin-bottom:8px; color:#a1a1aa;}
  .empty .small{font-size:11px;}
  .card-foot{margin-top:10px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.06); font-size:11px;}
  .filter{display:flex; flex-direction:column; gap:8px;}
  .search{position:relative; display:flex; align-items:center; border-radius:999px; padding:2px;}
  .search-icon{position:absolute; left:12px; color:#6e6e73; font-size:14px; pointer-events:none;}
  .search input{width:100%; padding:8px 12px 8px 32px; border-radius:999px; border:1px solid transparent; background: transparent; outline:none; font-size:13px; transition: .15s; color:#1d1d1f;}
  .search.focused{border-color: rgba(99,102,241,0.3); box-shadow: 0 0 0 4px rgba(99,102,241,0.08); background: rgba(255,255,255,0.9);}
  .pills{display:flex; gap:6px; flex-wrap:wrap;}
  .pill-btn{padding:5px 12px; border-radius:999px; font-size:11px; cursor:pointer; color:#6e6e73; font-weight:500; transition:.15s;}
  .pill-btn.active{background: #1d1d1f; color:#fff; border-color:#1d1d1f; box-shadow: 0 2px 8px rgba(0,0,0,0.12);}
  .pill-btn:hover{transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.08);}

  .layout{display:grid; grid-template-columns: 1.15fr .85fr; gap:12px; margin-top:12px;}
  .panel{border-radius:20px; overflow:hidden; display:flex; flex-direction:column;}
  .panel-head{padding:12px 14px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(0,0,0,0.06); backdrop-filter: blur(10px);}
  .panel-head h2{margin:0; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#6e6e73; font-weight:600;}
  .panel-actions{display:flex; gap:8px; align-items:center;}
  .ghost{border-radius:999px; font-size:12px; cursor:pointer; padding:6px 12px; font-weight:500; transition:.15s;}
  .ghost:hover{transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.08);}
  .table-wrap{overflow:auto; max-height: 560px;}
  table{width:100%; border-collapse:collapse; font-size:13px;}
  th{position:sticky; top:0; background: rgba(251,251,253,0.8); backdrop-filter: blur(12px); text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#6e6e73; padding:10px 12px; border-bottom:1px solid rgba(0,0,0,0.06); font-weight:600;}
  td{padding:12px; border-bottom:1px solid rgba(0,0,0,0.04); vertical-align:top;}
  tr{transition:.15s; cursor:pointer;}
  tr:hover{background: rgba(255,255,255,0.5);}
  tr.selected{background: rgba(99,102,241,0.08) !important; backdrop-filter: blur(8px);}
  .repo{font-weight:600; font-size:12px;}
  .issue-title{margin-top:2px;}
  .status{display:flex; gap:6px; align-items:center;}
  .status-dot{width:7px; height:7px; border-radius:50%;}
  .status-pill{color:#fff; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:600; letter-spacing:.02em; box-shadow: 0 1px 3px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.3);}
  .phase{font-size:11px; padding:4px 8px; border-radius:999px; font-weight:500;}
  .mono{font-family: ui-monospace, SFMono-Regular, monospace; font-size:12px;}
  .small{font-size:11px;}
  .muted{color:#6e6e73;}
  .detail{display:flex; flex-direction:column;}
  .detail-head{padding:16px; display:flex; justify-content:space-between; gap:12px; border-bottom:1px solid rgba(0,0,0,0.06);}
  .detail-title{font-weight:700; letter-spacing:-.01em; font-size:15px;}
  .detail-meta{padding:12px 16px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; border-bottom:1px solid rgba(0,0,0,0.06); background: rgba(255,255,255,0.4);}
  .status-pill.large{padding:5px 12px; font-size:12px;}
  .detail-grid{display:grid; grid-template-columns: 1fr 1fr; gap:12px; padding:12px 16px; border-bottom:1px solid rgba(0,0,0,0.06);}
  .tabs{display:flex; gap:8px; padding:12px 16px; border-bottom:1px solid rgba(0,0,0,0.06);}
  .tab{padding:6px 12px; border-radius:999px; font-size:12px; text-decoration:none; color:#1d1d1f; cursor:pointer; font-weight:500; transition:.15s;}
  .tab:hover{transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.08);}
  .logs-wrap{padding:14px; flex:1; display:flex; flex-direction:column; min-height:0;}
  .logs-head{display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;}
  .logs{margin:0; background: rgba(24,24,27,0.92); color:#e4e4e7; border-radius:12px; padding:14px; max-height: 420px; overflow:auto; white-space:pre-wrap; word-break:break-all; font-size:12px; line-height:1.6; border:1px solid rgba(255,255,255,0.06); box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 16px rgba(0,0,0,0.12); backdrop-filter: blur(12px);}
  .how{display:grid; gap:8px; margin-top:16px; text-align:left; font-size:12px;}
  .how div{display:flex; gap:10px; align-items:center;}
  .how b{width:20px; height:20px; border-radius:50%; background: linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; display:grid; place-items:center; font-size:11px; flex-shrink:0; box-shadow: 0 2px 8px #6366f133;}
  .empty.big{padding:36px 20px;}
  footer{display:flex; justify-content:space-between; align-items:center; padding:14px 6px; font-size:12px; color:#6e6e73;}
  footer a{color:#6366f1; text-decoration:none; font-weight:500;}
  footer a:hover{text-decoration:underline;}
  .links{display:flex; gap:8px;}
  @media (max-width: 960px){ .hero-content{grid-template-columns:1fr} .hero-stats{grid-template-columns: repeat(4,1fr)} .grid{grid-template-columns:1fr} .layout{grid-template-columns:1fr} .hero-stats{grid-template-columns: repeat(2,1fr)} }
</style>
