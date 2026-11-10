import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast, Table, Spinner, Select, ListHead, SummaryBar, K } from '../components/ui';

const LABEL: Record<string, string> = {
  create: 'ثبت', update: 'ویرایش', delete: 'حذف', login: 'ورود', logout: 'خروج',
  export: 'خروجی', backup: 'پشتیبان', restore: 'بازگردانی',
};
const ENTITY_FA: Record<string, string> = {
  Sale: 'فروشات', Receipt: 'رسیدات', Expense: 'مصارف', Salary: 'معاشات', Employee: 'کارمندان',
  Customer: 'مشتریان', User: 'کاربران', LookupItem: 'فهرست‌ها', System: 'سیستم', Attendance: 'حضور و غیاب',
  Company: 'شرکت', Machinery: 'ماشینری', Auth: 'ورود و خروج',
};
const COLORS: Record<string, string> = { create: 'ok', update: 'info', delete: 'bad', login: 'muted', logout: 'muted', export: 'warn', backup: 'warn', restore: 'bad' };

export default function ActivityPage() {
  const toast = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [entity, setEntity] = useState('');
  useEffect(() => { api.get(`/system/activity?limit=400${entity ? `&entity=${entity}` : ''}`).then(setRows).catch((e) => toast.error('بارگذاری نشد', e.message)); }, [entity]);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <ListHead actions={
          <SummaryBar>
            <K label="رویدادها" value={(rows || []).length} />
            <span className="sep" />
            <span className="muted">هر ثبت، ویرایش، حذف، خروجی و ورود/خروج ثبت می‌شود</span>
          </SummaryBar>
        }>
          <Select value={entity} onChange={setEntity} placeholder="همه بخش‌ها"
            options={Object.entries(ENTITY_FA).map(([x, l]) => ({ value: x, label: l }))} />
        </ListHead>
        <div className="card-b tight">
      {!rows ? <Spinner /> : (
        <Table head={['زمان', 'کاربر', 'عمل', 'بخش', 'تفصیل']} empty="سابقه‌ای موجود نیست.">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mono small">{new Date(r.createdAt + 'Z').toLocaleString('fa-IR')}</td>
              <td className="mono">{r.username}</td>
              <td><span className={`badge ${COLORS[r.action] || 'muted'}`}>{LABEL[r.action] || r.action}</span></td>
              <td className="small">{ENTITY_FA[r.entity] || r.entity}</td>
              <td className="small hide-sm">{r.detail}</td>
            </tr>
          ))}
        </Table>
      )}
        </div>
      </div>
    </div>
  );
}
