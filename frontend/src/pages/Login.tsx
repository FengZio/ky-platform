import { useState, FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { GraduationCap, Mail, Lock, Loader2 } from "lucide-react";

export default function Login() {
  const { user, loading, signIn, signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const result = isSignUp ? await signUp(email, password) : await signIn(email, password);
    if (result.error) setError(result.error);
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <GraduationCap className="w-12 h-12 text-primary-600 mx-auto mb-3" />
          <h1 className="text-2xl font-bold">考上鸭</h1>
          <p className="text-sm text-gray-400 mt-1">个人AI学习辅助工具</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-xl border p-6 space-y-4">
          <h2 className="font-semibold text-lg text-center">{isSignUp ? "创建账号" : "登录"}</h2>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">邮箱</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="email" required className="w-full pl-9 pr-3 py-2.5 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm" placeholder="your@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">密码</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="password" required minLength={6} className="w-full pl-9 pr-3 py-2.5 rounded-lg border bg-gray-50 dark:bg-gray-800 text-sm" placeholder="至少6位" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>

          {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg p-2">{error}</p>}

          <button type="submit" disabled={submitting} className="w-full py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSignUp ? "注册" : "登录"}
          </button>

          <p className="text-center text-sm text-gray-400">
            {isSignUp ? "已有账号？" : "没有账号？"}
            <button type="button" onClick={() => { setIsSignUp(!isSignUp); setError(""); }} className="ml-1 text-primary-600 hover:underline font-medium">
              {isSignUp ? "去登录" : "去注册"}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
