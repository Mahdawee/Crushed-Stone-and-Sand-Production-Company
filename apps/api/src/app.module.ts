import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './common/auth';
import { LicenseGuard } from './common/license-guard';
import { PrismaService } from './prisma.service';
import { AuthController } from './modules/auth.controller';
import { RootController } from './modules/root.controller';
import { CompanyController } from './modules/company.controller';
import { EmployeesController } from './modules/employees.controller';
import { CustomersController } from './modules/customers.controller';
import { SalesController } from './modules/sales.controller';
import { ReceiptsController } from './modules/receipts.controller';
import { ExpensesController } from './modules/expenses.controller';
import { SalariesController } from './modules/salaries.controller';
import { LookupsController } from './modules/lookups.controller';
import { ReportsController } from './modules/reports.controller';
import { SystemController } from './modules/system.controller';
import { ExportController, ImportController } from './modules/importexport.controller';
import { RecycleController } from './modules/recycle.controller';
import { LicenseController } from './modules/license.controller';
import { SearchController } from './modules/search.controller';

@Module({
  controllers: [
    RootController, AuthController, CompanyController, EmployeesController, CustomersController,
    SalesController, ReceiptsController, ExpensesController, SalariesController,
    LookupsController, ReportsController, SystemController, ExportController, ImportController,
    RecycleController, LicenseController, SearchController,
  ],
  providers: [
    PrismaService,
    { provide: APP_GUARD, useClass: AuthGuard },
    /*
     * ترتیب مهم است: AuthGuard اول (کاربر/نشست)، بعد LicenseGuard.
     * به این ترتیب مسیر «فعال‌سازی لایسنس» بدون نشست هم کار می‌کند و
     * پیام‌های خطا برای بقیه‌ی مسیرها روشن است.
     */
    { provide: APP_GUARD, useClass: LicenseGuard },
  ],
})
export class AppModule {}
