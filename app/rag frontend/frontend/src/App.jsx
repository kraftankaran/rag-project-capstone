import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Documents from "./pages/Documents";
import Search from "./pages/Search";
import Workspace from "./pages/Workspace";

export default function App() {
  return (
    <Router>
      <div className="app-container">
        <Sidebar />
        <div className="main-content">
          {/* Top header can be added here if needed, but modern apps often just use the page area */}
          <Routes>
            <Route path="/" element={<Navigate to="/documents" replace />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/search" element={<Search />} />
            <Route path="/workspace" element={<Workspace />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}