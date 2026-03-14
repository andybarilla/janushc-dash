import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "@/pages/login";
import ApprovalsPage from "@/pages/approvals";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="*" element={<Navigate to="/approvals" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
