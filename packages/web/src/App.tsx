import { Routes, Route, NavLink } from "react-router-dom";
import UploadPage from "./pages/Upload.tsx";
import HistoryPage from "./pages/History.tsx";
import TaskDetail from "./pages/TaskDetail.tsx";

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">OCR Center</h1>
        <nav className="nav">
          <NavLink to="/" end>
            Upload
          </NavLink>
          <NavLink to="/history">History</NavLink>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/task/:id" element={<TaskDetail />} />
        </Routes>
      </main>
    </div>
  );
}
