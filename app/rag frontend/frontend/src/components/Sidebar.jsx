import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Files, Search, MessageSquare, Settings, Zap, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const navItems = [
    { path: "/", label: "Documents", icon: Files },
    { path: "/search", label: "Search", icon: Search },
    { path: "/workspace", label: "Workspace", icon: MessageSquare },
  ];

  return (
    <motion.div 
      animate={{ width: isCollapsed ? '80px' : '260px' }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      style={{
        backgroundColor: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '1.5rem 0',
        zIndex: 10,
        position: 'relative'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'space-between', padding: '0 1.5rem', marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{
          background: 'linear-gradient(135deg, var(--primary), var(--accent))',
          borderRadius: '8px',
          padding: '6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--primary-foreground)'
        }}>
          <Zap size={20} />
        </div>
        </div>
        
        {!isCollapsed && (
          <motion.h1 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, background: 'linear-gradient(to right, #fff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
          >
            Neural<span style={{ fontWeight: 400 }}>RAG</span>
          </motion.h1>
        )}

        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          style={{
            position: 'absolute',
            right: '-12px',
            top: '2rem',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: '50%',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--muted-foreground)',
            zIndex: 20,
            boxShadow: 'var(--shadow)'
          }}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1, padding: '0 1rem' }}>
        {!isCollapsed && (
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', paddingLeft: '0.5rem' }}>
            Menu
          </p>
        )}
        
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              justifyContent: isCollapsed ? 'center' : 'flex-start',
              gap: '0.75rem',
              padding: '0.75rem',
              borderRadius: 'var(--radius)',
              textDecoration: 'none',
              color: isActive ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              backgroundColor: isActive ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
              fontWeight: isActive ? 600 : 500,
              transition: 'all 0.2s ease',
              border: isActive ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
              boxShadow: isActive ? '0 0 10px rgba(59, 130, 246, 0.05)' : 'none',
              position: 'relative'
            })}
            title={isCollapsed ? item.label : undefined}
          >
            {({ isActive }) => (
              <>
                <item.icon size={20} color={isActive ? 'var(--primary)' : 'currentColor'} style={{ flexShrink: 0 }} />
                
                <AnimatePresence>
                  {!isCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>

                {isActive && (
                  <motion.div
                    layoutId="active-indicator"
                    style={{
                      position: 'absolute',
                      left: '0',
                      width: '4px',
                      height: '60%',
                      backgroundColor: 'var(--primary)',
                      borderRadius: '0 4px 4px 0',
                      boxShadow: '0 0 8px rgba(59, 130, 246, 0.8)'
                    }}
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: '1.5rem', padding: '1.5rem 1rem 0 1rem' }}>
        <button style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'flex-start',
          gap: '0.75rem',
          padding: '0.75rem',
          width: '100%',
          backgroundColor: 'transparent',
          border: 'none',
          color: 'var(--muted-foreground)',
          cursor: 'pointer',
          borderRadius: 'var(--radius)',
          transition: 'all 0.2s ease',
          textAlign: 'left',
          fontWeight: 500
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--muted)';
          e.currentTarget.style.color = 'var(--foreground)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.color = 'var(--muted-foreground)';
        }}>
          <Settings size={20} style={{ flexShrink: 0 }} />
          {!isCollapsed && <span style={{ whiteSpace: 'nowrap' }}>Settings</span>}
        </button>
      </div>
    </motion.div>
  );
}
