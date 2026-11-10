import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** Company letterhead used on every printed document. */
export function DocHeader({ title, meta }: { title: string; meta?: { label: string; value: string }[] }) {
  const [c, setC] = useState<any>(null);
  useEffect(() => { api.get('/company').then(setC).catch(() => {}); }, []);
  return (
    <div className="doc-head">
      <div className="doc-head-main">
        <div className="doc-logo">ف</div>
        <div>
          <div className="doc-name">{c?.name || 'فردای روشن'}</div>
          <div className="doc-sub">{c?.activityType || 'تولید مواد ساختمانی'} — {c?.address || ''}</div>
          {c?.phone ? <div className="doc-sub">تماس: {c.phone}</div> : null}
        </div>
        <div style={{ flex: 1 }} />
        <div className="doc-title">{title}</div>
      </div>
      {meta?.length ? (
        <div className="doc-meta">
          {meta.map((m) => (
            <div key={m.label}><span>{m.label}:</span> <b>{m.value}</b></div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DocFooter({ extra }: { extra?: string }) {
  return (
    <div className="doc-footer">
      <div className="sign"><span>امضای مدیر مالی</span><i /></div>
      <div className="sign"><span>امضای سرپرست</span><i /></div>
      <div className="sign"><span>امضای گیرنده / مشتری</span><i /></div>
      {extra ? <div className="doc-note">{extra}</div> : null}
    </div>
  );
}
