import React from "react";
import PagingPanel from "./components/PagingPanel";

export default function LivePaging() {
  return (
    <div className="flex flex-col gap-4">
      <PagingPanel defaultOpen />
    </div>
  );
}
