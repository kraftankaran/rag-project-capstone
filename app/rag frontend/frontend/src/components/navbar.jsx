import { useState } from "react";
import { Link } from "react-router-dom";

export default function Navbar() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("content");
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    await fetch(`http://localhost:8000/search?q=${search}&type=${type}`);
    setLoading(false);
  };

  return (
    <div className="navbar">
      <div className="logo">🚀 RAG AI</div>

      <div className="nav-center">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="content">Content</option>
          <option value="title">Title</option>
        </select>

        <input
           value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search documents..."
        />

        <button onClick={handleSearch}>
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      <div className="nav-right">
        <Link to="/">Upload</Link>
        <Link to="/chat">Chat</Link>
      </div>
    </div>
  );
}