import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setAuth } from "../api";
import logo from "../assets/logo.png";

const ADMIN_EMAIL = "alanmorales117@gmail.com";
const ADMIN_USER_CACHE = "admin_users_cache";

type LoginResponse = {
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function getErrorMessage(error: unknown, fallback: string) {
  const apiError = error as ApiError;
  return apiError.response?.data?.message || fallback;
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
      banned: Boolean(user.banned || user.isBanned),
      blocked: Boolean(user.blocked || user.isBlocked),
      lastSeen: new Date().toISOString(),
    };
    const next = [nextUser, ...cached.filter((item) => String(item._id || item.id || item.email) !== id)];
    localStorage.setItem(ADMIN_USER_CACHE, JSON.stringify(next));
  } catch {
    // El cache local es solo apoyo visual para la demo.
  }
}

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data } = await api.post<LoginResponse>("/auth/login", {
        email: email.trim(),
        password,
      });

      if (!data.token) {
        throw new Error("No se recibio token de acceso");
      }

      const user = asRecord(data.user);
      if (user.banned || user.blocked || user.isBanned || user.isBlocked) {
        setError("Tu cuenta esta bloqueada. Contacta al administrador.");
        return;
      }

      const normalizedEmail = email.trim().toLowerCase();
      const storedUser = {
        ...user,
        name: user.name || "Morales",
        email: user.email || normalizedEmail,
        role: normalizedEmail === ADMIN_EMAIL ? "admin" : user.role || "usuario",
      };

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(storedUser));
      rememberAdminUser(storedUser);

      setAuth(data.token);
      nav("/dashboard");
    } catch (err: unknown) {
      setError(getErrorMessage(err, "No pudimos iniciar sesion. Revisa tus datos."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-wrap">
      <section className="auth-shell">
        <aside className="auth-panel">
          <div className="auth-panel-content">
            <span className="auth-kicker">Productividad personal</span>
            <h1>Tu tablero de tareas siempre listo.</h1>
            <p>
              Crea, organiza y sincroniza tus actividades desde una experiencia
              limpia, rapida y preparada para funcionar offline.
            </p>
            <div className="auth-benefits">
              <span>Modo offline</span>
              <span>Tablero Kanban</span>
              <span>Sincronizacion segura</span>
            </div>
          </div>
        </aside>

        <div className="card auth-card">
          <div className="brand auth-brand">
            <img src={logo} alt="To-Do App" className="logo-img" />
            <span className="auth-kicker">Bienvenido de nuevo</span>
            <h2>Iniciar sesion</h2>
            <p className="muted">Entra a tu espacio y continua donde te quedaste.</p>
          </div>

          <form className="form auth-form" onSubmit={onSubmit}>
            <label htmlFor="email">Correo electronico</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />

            <label htmlFor="password">Contrasena</label>
            <div className="pass">
              <input
                id="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Ingresa tu contrasena"
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

            {error && <div className="alert">{error}</div>}

            <button className="btn primary auth-submit" disabled={loading}>
              {loading ? "Entrando..." : "Entrar al dashboard"}
            </button>
          </form>

          <div className="footer-links">
            <span className="muted">No tienes una cuenta?</span>
            <Link to="/register" className="link">
              Crear cuenta
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
