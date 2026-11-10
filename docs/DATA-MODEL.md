# مدل داده

همه تاریخ‌ها **میلادی `YYYY-MM-DD`** ذخیره می‌شوند و طبق تقویم انتخابی نمایش داده می‌شوند.
مبالغ `REAL` (افغانی)، به جز `amountUsd` که جداگانه ثبت می‌شود.

| جدول | ستون‌های مهم |
|---|---|
| `Company` | id=1 ثابت، name, activityType, address, fiscalYear, financeManager, supervisor, phone, email |
| `Machinery` | name, model, plateNo, count, status, note |
| `Employee` | code (یکتا), name, fatherName, position, hireDate, baseSalary, phone, nationalId, address, contractPeriod, status, note |
| `Attendance` | employeeId, date, status (present/absent/leave/sick/official_holiday/friday), checkIn, checkOut, overtime, note — یکتا روی (employeeId, date) |
| `Customer` | code (یکتا), name, contactPerson, phone, truckPlate, openingBalance, note |
| `Sale` | no (یکتا), date, customerId, customerName, driverName, truckPlate, destination, materialId, materialName, volume, unitPrice, freightPerUnit, freightTotal, total, contractorId, contractorName, paymentType (cash/credit), note |
| `Receipt` | no (یکتا), date, customerId, customerName, amount, relatedBillNo, sourceId, sourceName, receivedBy, note |
| `Expense` | no (یکتا), date, description, categoryId, categoryName, contractorId, contractorName, purchaseBillNo, shopName, amountAfn, amountUsd, payerId, payerName, paymentType, note |
| `Salary` | no (یکتا), periodStart, periodLabel, calendar, year, month, payDate, employeeId, employeeName, baseSalary, bonus, penalty, overtimeAmount, total, payerName, paymentType (cash/hawala), note — یکتا روی (employeeId, periodStart) |
| `LookupItem` | type (material/expense_category/payer/receipt_source/contractor), name, extra, sortOrder, active |
| `User` | username (یکتا), fullName, passwordHash (SHA-256+salt), role (manager/employee), active, lastLoginAt |
| `Setting` | key → value (تقویم، پیشوند اسناد، حالت دخل، ظاهر…) |
| `ActivityLog` | username, action, entity, entityId, detail, createdAt |
| `Sequence` | scope (`S-1405`) → value (شمارنده اسناد) |

## رابطه‌ها

```
Customer 1 ──< Sale
Customer 1 ──< Receipt
Employee 1 ──< Attendance   (ON DELETE CASCADE)
Employee 1 ──< Salary       (RESTRICT — کارمند با سابقه معاش حذف نمی‌شود)
LookupItem (material)     ← Sale.materialId / materialName
LookupItem (contractor)   ← Sale.contractorId / Expense.contractorId
LookupItem (payer)        ← Expense.payerId / Salary.payerName
LookupItem (receipt_source) ← Receipt.sourceId / sourceName
```

> نام‌های `materialName`, `customerName` … به صورت **snapshot** ذخیره می‌شوند تا اگر نام یک قلم
> یا مشتری بعداً عوض شود، اسناد قدیمی همان‌طور که ثبت شده بودند بمانند.
