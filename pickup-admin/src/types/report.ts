export type ReportType = 'bookings' | 'cancellations' | 'drivers' | 'vehicles' | 'revenue' | 'commission' | 'wallet' | 'payments';

export interface ReportSummary {
  label: string;
  value: string | number;
}

export interface BaseReportData {
  summary: ReportSummary[];
  headers: string[];
  rows: any[][];
}
