export type PeriodPreset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "next7"
  | "next15"
  | "next30"
  | "currentMonth"
  | "previousMonth"
  | "nextMonth"
  | "currentYear"
  | "overdue"
  | "paidMonth"
  | "custom";

export type PeriodState = {
  preset: PeriodPreset;
  startDate: string;
  endDate: string;
};

function inputDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function periodForPreset(preset: PeriodPreset, base = new Date()): PeriodState {
  let start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  let end = new Date(base.getFullYear(), base.getMonth(), base.getDate());

  if (preset === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  }
  if (preset === "last7") start.setDate(start.getDate() - 6);
  if (preset === "last30") start.setDate(start.getDate() - 29);
  if (preset === "next7") end.setDate(end.getDate() + 7);
  if (preset === "next15") end.setDate(end.getDate() + 15);
  if (preset === "next30") end.setDate(end.getDate() + 30);
  if (preset === "currentMonth") {
    start = new Date(base.getFullYear(), base.getMonth(), 1);
    end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  }
  if (preset === "previousMonth") {
    start = new Date(base.getFullYear(), base.getMonth() - 1, 1);
    end = new Date(base.getFullYear(), base.getMonth(), 0);
  }
  if (preset === "currentYear") {
    start = new Date(base.getFullYear(), 0, 1);
    end = new Date(base.getFullYear(), 11, 31);
  }
  if (preset === "nextMonth") {
    start = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    end = new Date(base.getFullYear(), base.getMonth() + 2, 0);
  }
  if (preset === "overdue") {
    start = new Date(2000, 0, 1);
    end = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);
  }
  if (preset === "paidMonth") {
    start = new Date(base.getFullYear(), base.getMonth(), 1);
    end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  }

  return { preset, startDate: inputDate(start), endDate: inputDate(end) };
}

export function currentMonthPeriod() {
  return periodForPreset("currentMonth");
}
