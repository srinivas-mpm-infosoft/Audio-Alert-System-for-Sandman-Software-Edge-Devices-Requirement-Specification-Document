import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, X } from "lucide-react";

const ToastContext = createContext();

export const ToastProvider = ({ children }) => {
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });

  const showToast = useCallback((message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      
      {/* Global Toast UI */}
      {toast.show && (
        <div className=" fixed top-6 left-1/2 -translate-x-1/2 z-[9999] w-full max-w-sm px-4 animate-in slide-in-from-top-10 duration-300">
          <div className={`flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border bg-white ${
            toast.type === "success" ? "border-emerald-100 text-emerald-800" : "border-red-100 text-red-800"
          }`}>
            {toast.type === "success" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
            )}
            <p className="text-sm font-semibold flex-1">{toast.message}</p>
            <button onClick={() => setToast(p => ({ ...p, show: false }))} className="p-1 hover:bg-slate-100 rounded-md">
              <X className="h-4 w-4 text-slate-400" />
            </button>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
};

// Custom hook for easy access
export const useToast = () => useContext(ToastContext);