import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast, Table, Spinner, Select } from '../components/ui';

const LABEL: Record<string, string> = {
  create: 'ثبت', update: 'ویرایش', delete: 'حذف', login: 'ورود', logout: 'خروج',
  export: 'خروجی', backup: 'پشتیبان', restore: 'بازگردانی',
};
const COLORS: Record<string, string> = { create: 'ok', update: 'info', delete: 'bad', login: 'muted', logout: 'muted', export: 'warn', backup: 'warn', restore: 'bad' };

export default function ActivityPage() {
  const toast = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [entity, setEntity] = useState('');
  useEffect(() => { api.get(`/system/activity?limit=400${entity ? `&entity=${entity}` : ''}`).then(setRows).catch((e) => toast.error('بارگذاری نشد', e.message)); }, [entity]);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row between wrap">
        <p className="small muted">هر ثبت، ویرایش، حذف، خروجی و ورود/خروج در این جدول ثبت می‌شود.</p>
        <Select value={entity} onChange={setEntity} placeholder="همه بخش‌ها"
          options={['Sale', 'Receipt', 'Expense', 'Salary', 'Employee', 'Customer', 'User', 'LookupItem', 'System', 'Attendance', 'Company', 'Machinery'].map((x) => ({ value: x, label: x }))} />
      </div>
      {!rows ? <Spinner /> : (
        <Table head={['زمان', 'کاربر', 'عمل', 'بخش', 'تفصیل']} empty="سابقه‌ای موجود نیست.">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mono small">{new Date(r.createdAt + 'Z').toLocaleString('fa-IR')}</td>
              <td className="mono">{r.username}</td>
              <td><span className={`badge ${COLORS[r.action] || 'muted'}`}>{LABEL[r.action] || r.action}</span></td>
              <td className="mono small">{r.entity}</td>
              <td className="small">{r.detail}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
