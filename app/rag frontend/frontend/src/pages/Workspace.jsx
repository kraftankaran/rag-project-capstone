import { useState, useRef, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Document, Page, pdfjs } from "react-pdf";
import Markdown from "react-markdown";
import { Send, Maximize2, Minimize2, ChevronLeft, ChevronRight, Loader2, Search, FileText, Plus, History, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { motion, AnimatePresence } from "framer-motion";

// Configure PDF worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export default function Workspace() {
  const [searchParams] = useSearchParams();
  const docsParam = searchParams.get("docs");
  const singleDocParam = searchParams.get("doc");
  
  let docs = [];
  if (docsParam) {
    docs = docsParam.split(',').filter(Boolean);
  } else if (singleDocParam) {
    docs = [singleDocParam];
  }
  
  const chatIdParam = searchParams.get("chat_id");
  
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);
  const [activeChatTitle, setActiveChatTitle] = useState("");
  const navigate = useNavigate();
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const mockHistories = [
    { id: "chat_1", title: "Data Engineering Q&A", messages: [
      { role: "user", text: "What is the main architecture of the Data Engineering pipeline?" },
      { role: "bot", text: "The pipeline consists of ingesting raw data from Azure Blob Storage, processing it using Azure Databricks, and finally storing the refined data in a PostgreSQL database managed by pgvector for semantic search capabilities." },
      { role: "user", text: "How is it secured?" },
      { role: "bot", text: "Security is managed through Azure Service Principals, with role-based access control (RBAC) ensuring only authorized microservices can access the storage and database endpoints." }
    ]},
    { id: "chat_2", title: "System Architecture", messages: [
      { role: "user", text: "Can you explain the system architecture?" },
      { role: "bot", text: "Certainly. The system uses a FastAPI backend integrated with Azure Document Intelligence for OCR. Processed documents are embedded using an LLM and stored in PostgreSQL with pgvector. The frontend is built with React." }
    ]},
    { id: "chat_3", title: "Model Deployment Guide", messages: [
      { role: "user", text: "How do we deploy the models?" },
      { role: "bot", text: "Models are deployed using Docker containers. The `docker-compose.yml` orchestrates the API, Database, and Frontend containers simultaneously to ensure a consistent deployment environment." }
    ]}
  ];

  useEffect(() => {
    if (chatIdParam) {
      const history = mockHistories.find(h => h.id === chatIdParam);
      if (history) {
        setMessages(history.messages);
        setActiveChatTitle(history.title);
      }
    } else {
      setMessages([]);
      setActiveChatTitle("");
    }
  }, [chatIdParam]);

  const handleAsk = async () => {
    if (!query.trim()) return;

    const userMsg = { role: "user", text: query };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setQuery("");

    try {
      // Append instruction to filter by selected docs if there are multiple or specific docs open
      let payloadMessage = userMsg.text;
      if (docs.length > 0) {
        payloadMessage = `[INSTRUCTION: Restrict your knowledge and answers ONLY to the content found in the following documents: ${docs.map(d => d.split('/').pop()).join(', ')}. Do not use other documents.]\n\n${userMsg.text}`;
      }

      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: payloadMessage, conversation_id: "default_session" }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, { role: "bot", text: data.answer || "No response received." }]);
      } else {
        setMessages((prev) => [...prev, { role: "bot", text: "Error: Could not retrieve response from the server." }]);
      }
    } catch (e) {
      console.error("Chat API failed", e);
      setMessages((prev) => [...prev, { role: "bot", text: "Error: Connection to the server failed." }]);
    }

    setLoading(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      
      {/* Workspace Left Sidebar: Chat History */}
      <motion.div 
        animate={{ width: isHistoryCollapsed ? '50px' : '260px' }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        style={{
          borderRight: '1px solid var(--border)',
          backgroundColor: 'var(--sidebar-bg)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 5
        }}
      >
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: isHistoryCollapsed ? 'center' : 'space-between', alignItems: 'center' }}>
          {!isHistoryCollapsed && <span style={{ fontWeight: 600, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><History size={16} /> Recent Chats</span>}
          <button 
            className="btn btn-ghost" 
            style={{ padding: '0.25rem' }}
            onClick={() => setIsHistoryCollapsed(!isHistoryCollapsed)}
            title="Toggle History Sidebar"
          >
            {isHistoryCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        {!isHistoryCollapsed && (
          <div style={{ padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <button 
              className="btn btn-primary" 
              style={{ width: '100%', marginBottom: '1rem', padding: '0.5rem', display: 'flex', justifyContent: 'center' }}
              onClick={() => {
                setMessages([]);
                setActiveChatTitle("");
                navigate('/workspace');
              }}
            >
              <Plus size={16} /> New Chat
            </button>

            <div className="custom-scrollbar" style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {mockHistories.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => navigate(`/workspace?chat_id=${chat.id}`)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.75rem',
                    backgroundColor: chatIdParam === chat.id ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    border: chatIdParam === chat.id ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                    color: chatIdParam === chat.id ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius)',
                    fontSize: '0.875rem',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseOver={(e) => {
                    if (chatIdParam !== chat.id) {
                      e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                      e.currentTarget.style.color = 'var(--foreground)';
                    }
                  }}
                  onMouseOut={(e) => {
                    if (chatIdParam !== chat.id) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--muted-foreground)';
                    }
                  }}
                >
                  {chat.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </motion.div>

      {/* Middle side: PDF Viewer */}
      <div style={{ 
        flex: isExpanded ? 1 : 1.2, 
        borderRight: '1px solid var(--border)', 
        display: 'flex', 
        flexDirection: 'column',
        backgroundColor: '#1f2229', 
        transition: 'flex 0.3s ease'
      }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--background)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <FileText size={20} color="var(--primary)" />
            <span style={{ fontWeight: 600 }}>Document Preview ({docs.length})</span>
          </div>
          <button className="btn btn-ghost" onClick={() => setIsExpanded(!isExpanded)} title="Toggle layout">
            {isExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
        
        <div className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem' }}>
          {docs.length > 0 ? (
            docs.map((doc, idx) => (
              <PdfViewer key={idx} docParam={doc} isExpanded={isExpanded} />
            ))
          ) : (
            <div style={{ boxShadow: 'var(--shadow-lg)', backgroundColor: 'white', minHeight: '800px', minWidth: '600px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
              <FileText size={64} style={{ opacity: 0.2, marginBottom: '1rem' }} />
              <p>No document selected</p>
              <p style={{ fontSize: '0.875rem' }}>Select documents from the library to preview</p>
            </div>
          )}
        </div>
      </div>

      {/* Right side: Chat */}
      <div style={{ flex: isExpanded ? 1.5 : 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--background)', transition: 'flex 0.3s ease' }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>AI Workspace</h2>
            {activeChatTitle ? (
              <p style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>Viewing History: {activeChatTitle}</p>
            ) : (
              <p style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>Ask questions about your documents</p>
            )}
          </div>
        </div>
        
        <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {messages.length === 0 && (
            <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--muted-foreground)' }}>
              <div style={{ background: 'var(--muted)', display: 'inline-block', padding: '1rem', borderRadius: '50%', marginBottom: '1rem' }}>
                <Search size={32} color="var(--primary)" />
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--foreground)' }}>Ask anything</h3>
              <p style={{ marginTop: '0.5rem', maxWidth: '300px' }}>Ask questions, extract information, or summarize the document.</p>
            </div>
          )}

          {messages.map((m, i) => (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={i} 
              style={{ display: 'flex', justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}
            >
              {m.role === "bot" && (
                <div style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: '1rem' }}>
                  <span style={{ color: 'white', fontWeight: 'bold', fontSize: '14px' }}>AI</span>
                </div>
              )}
              <div style={{
                maxWidth: '80%',
                padding: '1rem 1.25rem',
                borderRadius: '1rem',
                backgroundColor: m.role === "user" ? 'var(--primary)' : 'var(--card)',
                color: m.role === "user" ? 'var(--primary-foreground)' : 'var(--foreground)',
                border: m.role === "bot" ? '1px solid var(--border)' : 'none',
                boxShadow: 'var(--shadow)',
                fontSize: '0.95rem',
                lineHeight: 1.6
              }}>
                {m.role === "bot" ? (
                  <Markdown>{m.text}</Markdown>
                ) : (
                  m.text
                )}
              </div>
            </motion.div>
          ))}

          {loading && (
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', justifyContent: 'flex-start' }}>
               <div style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: '1rem' }}>
                  <span style={{ color: 'white', fontWeight: 'bold', fontSize: '14px' }}>AI</span>
               </div>
               <div style={{
                 padding: '1rem 1.25rem',
                 borderRadius: '1rem',
                 backgroundColor: 'var(--card)',
                 border: '1px solid var(--border)',
                 display: 'flex',
                 alignItems: 'center',
                 gap: '0.5rem'
               }}>
                 <span style={{ width: '6px', height: '6px', background: 'var(--primary)', borderRadius: '50%', animation: 'pulse 1.5s infinite' }} />
                 <span style={{ width: '6px', height: '6px', background: 'var(--primary)', borderRadius: '50%', animation: 'pulse 1.5s infinite 0.2s' }} />
                 <span style={{ width: '6px', height: '6px', background: 'var(--primary)', borderRadius: '50%', animation: 'pulse 1.5s infinite 0.4s' }} />
               </div>
             </motion.div>
          )}
          <div ref={endRef} />
        </div>

        <div style={{ padding: '1.5rem', borderTop: '1px solid var(--border)', backgroundColor: 'var(--card)' }}>
          <div style={{ 
            position: 'relative', 
            display: 'flex', 
            alignItems: 'flex-end',
            backgroundColor: 'var(--background)',
            border: '1px solid var(--border)',
            borderRadius: '1rem',
            padding: '0.5rem'
          }}>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask a question about the document... (Press Enter to send)"
              rows={1}
              style={{
                flex: 1,
                resize: 'none',
                padding: '0.75rem',
                border: 'none',
                backgroundColor: 'transparent',
                color: 'var(--foreground)',
                outline: 'none',
                fontSize: '0.95rem',
                minHeight: '44px',
                maxHeight: '120px'
              }}
              className="custom-scrollbar"
            />
            <button 
              onClick={handleAsk}
              disabled={!query.trim() || loading}
              style={{
                background: query.trim() ? 'var(--primary)' : 'var(--muted)',
                color: query.trim() ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                border: 'none',
                borderRadius: '50%',
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: query.trim() ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s ease',
                margin: '4px'
              }}
            >
              <Send size={18} style={{ transform: 'translateX(-1px)' }} />
            </button>
          </div>
          <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--muted-foreground)', marginTop: '0.75rem' }}>
            NeuralRAG can make mistakes. Consider verifying important information.
          </p>
        </div>
      </div>
    </div>
  );
}

function PdfViewer({ docParam, isExpanded }) {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);

  function onDocumentLoadSuccess({ numPages }) {
    setNumPages(numPages);
  }

  return (
    <div style={{ marginBottom: '3rem', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ 
        width: '100%', 
        maxWidth: isExpanded ? '550px' : '750px',
        padding: '0.75rem 1rem', 
        backgroundColor: 'var(--card)', 
        border: '1px solid var(--border)',
        borderRadius: '8px 8px 0 0',
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center' 
      }}>
        <div style={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
          {docParam.split('/').pop()}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--muted)', padding: '0.25rem', borderRadius: 'var(--radius)' }}>
          <button 
            className="btn btn-ghost" 
            style={{ padding: '0.25rem' }} 
            onClick={() => setPageNumber(p => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
          >
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: '0.75rem', margin: '0 0.25rem', fontFamily: 'monospace' }}>
            {pageNumber} / {numPages || '-'}
          </span>
          <button 
            className="btn btn-ghost" 
            style={{ padding: '0.25rem' }} 
            onClick={() => setPageNumber(p => Math.min(numPages || p, p + 1))}
            disabled={pageNumber >= (numPages || Infinity)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      
      <div style={{ boxShadow: 'var(--shadow-lg)', backgroundColor: 'white', minHeight: '800px', minWidth: isExpanded ? '500px' : '700px' }}>
        <Document
          file={`/download/${docParam}`}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={<div style={{ padding: '4rem', color: 'black', display: 'flex', justifyContent: 'center' }}><Loader2 className="animate-spin" /></div>}
          error={
            <div style={{ height: '800px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#666', background: 'white' }}>
              <FileText size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
              <p>Failed to load document preview.</p>
            </div>
          }
        >
          <Page pageNumber={pageNumber} width={isExpanded ? 500 : 700} />
        </Document>
      </div>
    </div>
  );
}
