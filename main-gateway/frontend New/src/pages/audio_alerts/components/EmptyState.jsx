import React from "react";
import { Inbox, ShieldOff } from "lucide-react";

export default function EmptyState({ icon: Icon = Inbox, title = "No data", message = "Nothing to show here yet.", action }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="p-4 bg-slate-100 rounded-full mb-4">
        <Icon className="h-8 w-8 text-slate-400" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-slate-700 mb-1">{title}</h3>
      <p className="text-sm text-slate-400 max-w-xs">{message}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function AccessDenied({ resource = "this page" }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="p-4 bg-red-50 rounded-full mb-4">
        <ShieldOff className="h-8 w-8 text-red-400" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-slate-700 mb-1">Access Denied</h3>
      <p className="text-sm text-slate-400 max-w-xs">You do not have permission to access {resource}. Contact your administrator.</p>
    </div>
  );
}
