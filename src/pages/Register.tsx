import {useState} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {api, setAuth} from '../api';
import logo from '../assets/logo.png';


export default function Register() {
    const nav = useNavigate();
    const [name , setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(""); setLoading(true);
        try{
            const {data} = await api.post("/auth/register", {name, email, password});
            localStorage.setItem("token", data.token);
            setAuth(data.token);
            nav("/dashboard");
        }catch (err: any) {
            setError(err.response?.data?.message || "Error al registrarte papi intentalo de nuevo");
        }finally {
            setLoading(false);
        }
    }

    return (
        <div className="auth-wrap">
            <div className="card">
                <div className="brand">
                    <img src={logo} alt="Logo" className="logo-img" />
                    <h2>Crear Cuenta</h2>
                    <p className="muted">Únete a To-Do App y organiza tus tareas de manera eficiente</p>
                </div>
                <form className="form" onSubmit={onSubmit}>
                    <label>Nombre completo</label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ingresa tu nombre papí"
                        required
                    />
                    <label> Correo electrónico </label>
                    <input
                        type="email"
                        placeholder="Ingresa tu correo electrónico papí"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                    <label>Contraseña</label>
                    <input
                        type="password"
                        placeholder="Ingresa tu contraseña papí"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                    <button type="submit" disabled={loading}>
                        {loading ? "Registrando..." : "Registrarse"}
                    </button>
                    <p className="muted">¿Ya tienes una cuenta? <Link to="/">Inicia sesión</Link></p>
                    {error && <p className="error">{error}</p>}
                </form>
            </div>
        </div>
    );
}