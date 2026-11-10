import { IconChevron, IconPlus } from '../components/icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Text, Table, Spinner, Field, ListHead, SearchBox, SummaryBar, K } from '../components/ui';
import { LOOKUP_META } from './lookupMeta';

export default function LookupsPage() {
  const { type } = useParams();
  const meta = LOOKUP_META[type || 'material'];
  const { isManager } = useSession();
  const toast = useToast();
  const [d, setD] = useState<any>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive' | 'used'>('all');
  const [newRow, setNewRow] = useState({ name: '', extra: '', sortOrder: '' });
  const [dirty, setDirty] = useState<Record<number, any>>({});
  const [confirmDel, setConfirmDel] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => { setD(await api.get(`/lookups/manage?type=${type}`)); setDirty({}); };
  useEffect(() => { setD(null); load().catch((e) => toast.error('بارگذاری نشد', e.message)); }, [type]);

  const rows = useMemo(() => {
    let r = [...(d?.rows || [])];
    r = r.map((x) => (dirty[x.id] ? { ...x, ...dirty[x.id] } : x));
    if (q) r = r.filter((x: any) => x.name.includes(q) || (x.extra || '').includes(q));
    if (filter === 'active') r = r.filter((x: any) => x.active);
    if (filter === 'inactive') r = r.filter((x: any) => !x.active);
    if (filter === 'used') r = r.filter((x: any) => x.usage > 0);
    return r;
  }, [d, q, filter, dirty]);

  const counts = useMemo(() => ({
    all: d?.rows?.length || 0,
    active: (d?.rows || []).filter((x: any) => x.active).length,
    inactive: (d?.rows || []).filter((x: any) => !x.active).length,
    used: (d?.rows || []).filter((x: any) => x.usage > 0).length,
  }), [d]);

  const edit = (id: number, patch: any) => setDirty((p) => ({ ...p, [id]: { ...(p[id] || {}), ...patch } }));

  const saveAll = async () => {
    setBusy(true);
    try {
      for (const [id, patch] of Object.entries(dirty)) {
        const base = d.rows.find((r: any) => r.id === Number(id));
        await api.put(`/lookups/${id}`, { ...base, ...patch });
      }
      toast.success(`${Object.keys(dirty).length} تغییر ذخیره شد`);
      await load();
    } catch (e: any) { toast.error('ذخیره نشد', e.message); }
    finally { setBusy(false); }
  };

  const add = async () => {
    if (!newRow.name.trim()) { toast.warn('نام را وارد کنید.'); return; }
    try {
      await api.post('/lookups', { type, name: newRow.name, extra: newRow.extra, sortOrder: newRow.sortOrder ? Number(newRow.sortOrder) : undefined });
      setNewRow({ name: '', extra: '', sortOrder: '' }); await load(); toast.success('افزوده شد');
    } catch (e: any) { toast.error('افزودن انجام نشد', e.message); }
  };

  const toggle = async (r: any) => {
    if (Object.keys(dirty).length) { toast.warn('اول تغییرات را ذخیره یا لغو کنید.'); return; }
    await api.put(`/lookups/${r.id}`, { ...r, active: !r.active });
    await load();
  };

  const reorder = async (r: any, dir: -1 | 1) => {
    if (Object.keys(dirty).length) { toast.warn('اول تغییرات را ذخیره کنید.'); return; }
    const list = [...d.rows];
    const i = list.findIndex((x: any) => x.id === r.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await api.post('/lookups/reorder', { type, ids: list.map((x: any) => x.id) });
    await load();
  };

  const doDelete = async () => {
    const r = confirmDel;
    setConfirmDel(null);
    try {
      const res = await api.del(`/lookups/${r.id}`);
      await load();
      if (res.deactivated) toast.warn('ردیف غیر فعال شد', `در ${res.usage} سند استفاده شده بود — برای حفظ سابقه حذف نشد.`);
      else toast.success('ردیف حذف شد');
    } catch (e: any) { toast.error('حذف نشد', e.message); }
  };

  const askDelete = (r: any) => {
    if (r.usage > 0) {
      toast.confirm({
        title: 'این ردیف استفاده شده است', confirmText: 'غیر فعال کن', kind: 'primary',
        body: `«${r.name}» در ${r.usage} سند استفاده شده است. برای محفوظ ماندن سابقه اسناد، حذف نمی‌شود بلکه غیر فعال می‌شود (در کشوی شیت‌ها دیده نمی‌شود).`,
        onConfirm: async () => { const res = await api.del(`/lookups/${r.id}`); await load(); toast.warn('غیر فعال شد'); },
      });
    } else {
      toast.confirm({
        title: 'حذف ردیف؟', body: `«${r.name}» در هیچ سندی استفاده نشده و برای همیشه حذف می‌شود.`, confirmText: 'حذف کن',
        onConfirm: async () => { await api.del(`/lookups/${r.id}`); await load(); toast.success('حذف شد'); },
      });
    }
  };

  if (!meta) return <div className="card card-b">نوع فهرست ناشناخته است.</div>;
  if (!d) return <Spinner />;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row between wrap">
        <div>
          <h1 style={{ fontSize: '1.15rem' }}>{meta.title}</h1>
          <p className="small muted">{meta.hint}</p>
        </div>
        <Link className="btn" to="/settings"><IconChevron dir="start" size={14} /> تنظیمات</Link>
      </div>

      <div className="card">
        <ListHead actions={
          Object.keys(dirty).length ? (
            <>
              <span className="badge warn">{Object.keys(dirty).length} تغییر ذخیره‌نشده</span>
              <button className="btn" onClick={() => setDirty({})}>لغو</button>
              <button className="btn primary" onClick={saveAll} disabled={busy}>{busy ? 'ذخیره…' : 'ذخیره تغییرات'}</button>
            </>
          ) : (
            <SummaryBar>
              <K label="ردیف" value={counts.all} />
              <span className="sep" />
              <K label="فعال" value={counts.active} tone="ok" />
              <span className="sep" />
              <K label="استفاده‌شده" value={counts.used} />
            </SummaryBar>
          )
        }>
          <SearchBox value={q} onChange={setQ} placeholder="جستجو در نام‌ها…" width={240} />
          <div className="filters">
            <div className="pill-tabs">
              {([['all', 'همه'], ['active', 'فعال'], ['inactive', 'غیر فعال'], ['used', 'استفاده‌شده']] as const).map(([k, l]) => (
                <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k as any)}>{l} ({counts[k as keyof typeof counts]})</button>
              ))}
            </div>
          </div>
        </ListHead>

      {isManager ? (
        <div className="card"><div className="card-b">
          <div className="row wrap" style={{ alignItems: 'flex-end', gap: 10 }}>
            <Field label="نام"><Text value={newRow.name} onChange={(v) => setNewRow({ ...newRow, name: v })} onEnter={add} /></Field>
            <Field label={meta.extraLabel}><Text value={newRow.extra} onChange={(v) => setNewRow({ ...newRow, extra: v })} /></Field>
            <Field label="ترتیب"><Text value={newRow.sortOrder} onChange={(v) => setNewRow({ ...newRow, sortOrder: v })} /></Field>
            <button className="btn primary" onClick={add}><IconPlus size={15} /> افزودن</button>
          </div>
        </div></div>
      ) : null}

        <div className="card-b tight">
      <Table head={['ترتیب', 'نام', meta.extraLabel, 'استفاده در اسناد', 'فعال', '']}>
        {rows.map((r: any) => (
          <tr key={r.id} style={{ opacity: r.active ? 1 : .55 }}>
            <td>
              <div className="row" style={{ gap: 2 }}>
                <button className="btn sm ghost" onClick={() => reorder(r, -1)}>▲</button>
                <button className="btn sm ghost" onClick={() => reorder(r, 1)}>▼</button>
                <span className="mono small">{r.sortOrder}</span>
              </div>
            </td>
            <td><input className="input" value={r.name} onChange={(e) => edit(r.id, { name: e.target.value })} style={{ minWidth: 150 }} /></td>
            <td><input className="input" value={r.extra} onChange={(e) => edit(r.id, { extra: e.target.value })} style={{ minWidth: 100 }} /></td>
            <td>{r.usage > 0 ? <span className="badge info">{r.usage} سند</span> : <span className="badge muted">استفاده نشده</span>}</td>
            <td>
              <button className={`btn sm ${r.active ? 'primary' : ''}`} onClick={() => toggle(r)}>{r.active ? 'فعال' : 'غیر فعال'}</button>
            </td>
            <td><button className="btn sm danger" onClick={() => askDelete(r)}>حذف</button></td>
          </tr>
        ))}
      </Table>
        </div>
      </div>

      <p className="small muted">
        ردیف غیر فعال در کشوی شیت‌ها دیده نمی‌شود اما در اسناد قدیمی محفوظ می‌ماند.
      </p>
    </div>
  );
}
