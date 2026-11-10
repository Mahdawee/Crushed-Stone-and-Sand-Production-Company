/**
 * ورودی مشترک تست DOM: کامپوننت‌های واقعی پروژه.
 *  • Picker   → dom.test.mjs (DatePicker)
 *  • mountApp → sidebar.test.mjs (Layout داخل MemoryRouter)
 */
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Layout from '../../apps/web/src/components/Layout';
import { DatePicker } from '../../apps/web/src/components/DatePicker';
import { Modal, Text, Num } from '../../apps/web/src/components/ui';

export function Picker(props: any) {
  const [v, setV] = React.useState(props.initial || '');
  return React.createElement('div', null,
    React.createElement(DatePicker, {
      value: v, onChange: setV, calendar: 'jalali', clearable: true, ...props.extra,
    }),
    React.createElement('span', { 'data-testid': 'val' }, v),
  );
}

export function mountApp() {
  return React.createElement(
    MemoryRouter,
    { initialEntries: ['/'] },
    React.createElement(Routes, null,
      React.createElement(Route, { path: '/', element: React.createElement(Layout) },
        React.createElement(Route, { index: true, element: React.createElement('div', null, 'صفحه آزمایشی') }),
      ),
    ),
  );
}

/**
 * فرم آزمایشی: همان الگوی واقعی صفحه‌ها —
 *   <Modal onClose={() => setForm(null)}>
 * با این تفاوت مهم که اینجا هم `onClose` یک تابع تازه در هر رندر است (دقیقاً
 * مثل همه‌ی صفحات). اگر Modal فوکوس را بدزدد، تایپ دوم انجام نمی‌شود.
 */
export function FormHarness() {
  const [form, setForm] = React.useState<any>({ name: '', amount: 0 });
  const [typed, setTyped] = React.useState('');
  return React.createElement('div', null,
    React.createElement('span', { 'data-testid': 'name' }, form?.name ?? ''),
    React.createElement('span', { 'data-testid': 'typed' }, typed),
    form
      ? React.createElement(Modal, {
          title: 'آزمون', onClose: () => setForm(null),
          /* شمارنده‌ی ذخیره — همان نقشی که save در صفحه‌ها دارد */
          onEnter: () => { (globalThis as any).__saved = ((globalThis as any).__saved || 0) + 1; },
        },
          React.createElement(Text, {
            value: form.name,
            onChange: (v: string) => { setForm({ ...form, name: v }); setTyped((t) => t + '|' + v); },
            autoFocus: true,
          }),
          React.createElement(Num, { value: form.amount, onChange: (v: number) => setForm({ ...form, amount: v }) }),
        )
      : React.createElement('button', { onClick: () => setForm({ name: '', amount: 0 }) }, 'باز کن'),
  );
}

/** ورودی عددی تنها — برای بررسی رفتار تایپ در Num */
export function NumHarness() {
  const [v, setV] = React.useState<any>(0);
  return React.createElement('div', null,
    React.createElement(Num, { value: v, onChange: setV }),
    React.createElement('span', { 'data-testid': 'num' }, String(v)),
  );
}
