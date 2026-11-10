import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './common/auth';
import { PrismaService } from './prisma.service';
import { AuthController } from './modules/auth.controller';
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
import { ExportController } from './modules/importexport.controller';

@Module({
  controllers: [
    AuthController, CompanyController, EmployeesController, CustomersController,
    SalesController, ReceiptsController, ExpensesController, SalariesController,
    LookupsController, ReportsController, SystemController, ExportController,
  ],
  providers: [PrismaService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
