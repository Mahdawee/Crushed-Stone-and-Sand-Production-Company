/**
 * ورودی مشترک تست DOM: کامپوننت‌های واقعی پروژه.
 *  • Picker   → dom.test.mjs (DatePicker)
 *  • mountApp → sidebar.test.mjs (Layout داخل MemoryRouter)
 */
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Layout from '../../apps/web/src/components/Layout';
import { DatePicker } from '../../apps/web/src/components/DatePicker';

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
