// Top-level application shell.
// Single responsibility: the route table. No API calls or business logic
// here -- pages compose the feature components.

import { Navigate, Route, Routes } from "react-router-dom";

import AppLayout from "@/layouts/AppLayout";
import AskPage from "@/pages/AskPage";
import DocumentsPage from "@/pages/DocumentsPage";

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {/* /ask is the default: asking questions is the product, the
            library is supporting furniture. `replace` keeps "/" out of
            history so Back doesn't bounce through the redirect. */}
        <Route index element={<Navigate to="/ask" replace />} />
        <Route path="ask" element={<AskPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="*" element={<Navigate to="/ask" replace />} />
      </Route>
    </Routes>
  );
}
