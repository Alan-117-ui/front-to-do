import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setAuth } from "../api";
import logo from "../assets/logo.png";

const ADMIN_EMAIL = "alanmorales117@gmail.com";
const ADMIN_USER_CACHE = "admin_users_cache";

type RegisterResponse = {
  token?: string;
  user?: unknown;
};

type ApiError = {
  response?: {
    data?: {
      message?: string;
    };
  };
};

function getErrorMessage(error: unknown, fallback: string) {
  const apiError = error as ApiError;
  return apiError.response?.data?.message || fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function rememberAdminUser(user: Record<string, unknown>) {
  try {
    const id = String(user._id || user.id || user.email || "");
    const cached = JSON.parse(localStorage.getItem(ADMIN_USER_CACHE) || "[]") as Array<Record<string, unknown>>;
    const nextUser = {
      id,
      _id: id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: true,
      online: true,
      banned: false,
      blocked: false,
      lastSeen: new Date().toISOString(),
    };
    const next = [nextUser, ...cached.filter((item) => String(item._id || item.id || item.email) !== id)];
    localStorage.setItem(ADMIN_USER_CACHE, JSON.stringify(next));
  } catch {
    // El cache local es solo apoyo visual para la demo.
  }
}

export default function Register() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const passwordScore = useMemo(() => {
    let score = 0;
    if (password.length >= 6) score += 1;
    if (password.length >= 10) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    return score;
  }, [password]);

  const passwordLabel = ["Muy corta", "Basica", "Buena", "Segura", "Fuerte"][passwordScore];
  const passwordsMatch = !confirmPassword || password === confirmPassword;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Las contrasenas no coinciden.");
      return;
    }

    if (password.length < 6) {
      setError("La contrasena debe tener al menos 6 caracteres.");
      return;
    }

    setLoading(true);

    try {
      const { data } = await api.post<RegisterResponse>("/auth/register", {
        name: name.trim(),
        email: email.trim(),
        password,
      });

      if (!data.token) {
        throw new Error("No se recibio token de acceso");
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = asRecord(data.user);
      const storedUser = {
        ...user,
        name: user.name || name.trim() || "Morales",
        email: user.email || normalizedEmail,
        role: normalizedEmail === ADMIN_EMAIL ? "admin" : user.role || "usuario",
      };

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(storedUser));
      rememberAdminUser(storedUser);

      setAuth(data.token);
      nav("/dashboard");
    } catch (err: unknown) {
      setError(getErrorMessage(err, "No pudimos crear tu cuenta. Intentalo de nuevo."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-wrap">
      <section className="auth-shell register-shell">
        <aside className="auth-panel">
          <div className="auth-panel-content">
            <span className="auth-kicker">Nuevo espacio</span>
            <h1>Empieza con un tablero claro desde el primer dia.</h1>
            <p>
              Registra tu cuenta, crea tareas y lleva el avance de tus pendientes
              con filtros, estados y sincronizacion.
            </p>
            <div className="auth-benefits">
              <span>Registro rapido</span>
              <span>Progreso visible</span>
              <span>Datos guardados</span>
            </div>
          </div>
        </aside>

        <div className="card auth-card">
          <div className="brand auth-brand">
            <img src={logo} alt="To-Do App" className="logo-img" />
            <span className="auth-kicker">Crear acceso</span>
            <h2>Crear cuenta</h2>
            <p className="muted">Completa tus datos para entrar al dashboard.</p>
          </div>

          <form className="form auth-form" onSubmit={onSubmit}>
            <label htmlFor="name">Nombre completo</label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Tu nombre"
              required
            />

            <label htmlFor="register-email">Correo electronico</label>
            <input
              id="register-email"
              type="email"
              autoComplete="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />

            <label htmlFor="register-password">Contrasena</label>
            <div className="pass">
              <input
                id="register-password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Minimo 6 caracteres"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                className="ghost"
                onClick={() => setShow((value) => !value)}
                aria-label="Mostrar u ocultar contrasena"
              >
                {show ? "Ocultar" : "Ver"}
              </button>
            </div>

            <div className="password-meter" aria-label={`Seguridad: ${passwordLabel}`}>
              <span className={`meter-fill score-${passwordScore}`} />
            </div>
            <p className="form-note">Seguridad: {passwordLabel}</p>

            <label htmlFor="confirm-password">Confirmar contrasena</label>
            <input
              id="confirm-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Repite tu contrasena"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
            {!passwordsMatch && <p className="field-error">Las contrasenas no coinciden.</p>}

            {error && <div className="alert">{error}</div>}

            <button className="btn primary auth-submit" disabled={loading}>
              {loading ? "Creando cuenta..." : "Crear cuenta"}
            </button>
          </form>

          <div className="footer-links">
            <span className="muted">Ya tienes una cuenta?</span>
            <Link to="/" className="link">
              Iniciar sesion
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
