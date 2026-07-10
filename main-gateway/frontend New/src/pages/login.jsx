import { useState, useEffect } from "react";
import logo from "../assets/apple-touch-icon.png";
import { targetUrl } from "../config";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const [fpOpen, setFpOpen] = useState(false);
  const [fpUser, setFpUser] = useState("");
  const [fpNew, setFpNew] = useState("");
  const [fpConfirm, setFpConfirm] = useState("");
  const [fpError, setFpError] = useState("");


  useEffect(() => {
    // Explicitly wipe state on component mount (refresh)
    const clearAll = () => {
      setUsername("");
      setPassword("");
      setError("");
      setFpUser("");
      setFpNew("");
      setFpConfirm("");
      setFpError("");
    };

    clearAll();
  }, []);

  async function login(e) {
    if (e) e.preventDefault(); // Prevent page refresh if using form
    setError("");

    if (!username || !password) {
      setError("Username and password required");
      return;
    }

    try {
      const res = await fetch(`${targetUrl}/login`, {
        method: "POST",
        credentials: 'include',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      // Check if it's JSON to avoid "Unexpected token <" error
      const contentType = res.headers.get("content-type");
      if (res.ok) {
        window.location.href = "/";
      } else if (contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setError(data.error || "Login failed");
      } else {
        setError("Server error: Received HTML instead of JSON");
      }
    } catch (err) {
      setError("Network error. Please check your connection.");
    }
  }

  async function resetPassword() {
    setFpError("");
    if (!fpUser || !fpNew || !fpConfirm) {
      setFpError("All fields required");
      return;
    }
    if (fpNew !== fpConfirm) {
      setFpError("Passwords do not match");
      return;
    }

    try {
      const res = await fetch(`${targetUrl}/reset-password`, {
        method: "POST",
        credentials: 'include',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: fpUser, newPassword: fpNew }),
      });

      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        if (data.status === "success") {
          alert("Password updated. You may log in.");
          setFpOpen(false);
          setFpUser("");
          setFpNew("");
          setFpConfirm("");
        } else {
          setFpError(data.error || "Reset failed");
        }
      } else {
        setFpError("Server error: Invalid response format");
      }
    } catch (err) {
      setFpError("Network error.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center font-[Frutiger] text-[#1f2937] bg-[radial-gradient(1200px_700px_at_50%_30%,#ffffff_0%,#e9edf3_40%,#dfe3ea_60%,#cfd6e2_78%,#c7cedc_100%),linear-gradient(135deg,#f5f7fb_0%,#6ec522_40%,#dbe2ee_100%)] bg-fixed">
      <div className="w-[min(550px,92vw)] bg-white rounded-[12px] shadow-[0_10px_30px_rgba(0,0,0,0.18)] px-[22px] py-[36px] sm:px-[56px] sm:py-[10px] text-center transition-all duration-150">
        <img src={logo} alt="logo" className="w-48 relative top-1/2 left-1/2 -translate-x-1/2  "/>        <h2 className="text-[36px] font-bold text-[#111827] mb-[26px] tracking-[0.2px] ">
          Gateway Login
        </h2>

        <div className="text-left mt-[10px] mb-[14px]">
          <label className="block text-[16px] font-[900] text-black/80 mb-[6px] ml-[2px]">Username</label>
          <input
            className="w-full px-[14px] py-[12px] text-[15px] border border-[#dcdfe4] rounded-[8px] bg-white focus:outline-none focus:border-[#4e7ac7] focus:ring-[4px] focus:ring-[#80a7ff66] transition-all duration-150 box-border"
            value={username}
            autoComplete="off" // Add this
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
          />
        </div>

        <div className="text-left mt-[10px] mb-[14px]">
          <label className="block text-[16px] font-[900] text-black/80 mb-[6px] ml-[2px]">Password</label>
          <input
            type="password"
            autoComplete="new-password"
            className="w-full px-[14px] py-[12px] text-[15px] border border-[#dcdfe4] rounded-[8px] bg-white focus:outline-none focus:border-[#4e7ac7] focus:ring-[4px] focus:ring-[#80a7ff66] transition-all duration-150 box-border"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
          />
        </div>

        <div className="mt-[12px]">
          <button
            onClick={login}
            className="w-full py-[12px] px-[16px] rounded-[8px] text-[15px] font-semibold text-white bg-[#4e7ac7] hover:bg-[#436da8] transition-all duration-150 active:translate-y-[0.5px]"
          >
            Log in
          </button>
        </div>

        <div className="text-right mt-[19px]">
          <button
            onClick={() => setFpOpen(true)}
            className="text-[16px] font-bold text-[rgba(0,0,255,0.767)] hover:text-[#4e7ac7] hover:underline transition-colors"
          >
            Forgot your password?
          </button>
        </div>

        <div className="text-[#e11d48] text-[14px] mt-[10px] min-h-[18px]">
          {error}
        </div>
      </div>

      {/* Forgot Password Modal */}
      {fpOpen && (
        <div className="fixed inset-0 bg-[#111827]/45 backdrop-blur-[4px] flex items-center justify-center z-50 px-[20px]">
          <div className="relative w-[min(420px,92vw)] bg-white rounded-[12px] shadow-[0_20px_50px_rgba(0,0,0,0.28)] px-[28px] py-[28px] pb-[24px] text-center">
            <button
              onClick={() => setFpOpen(false)}
              className="absolute top-[10px] right-[20px] text-[30px] text-[#6b7280] hover:text-[#e11d48] transition-colors p-[5px]"
            >
              &times;
            </button>
            <h3 className="text-[22px] font-semibold text-[#111827] mb-[16px]">Reset Password</h3>
            <div className="space-y-[12px] text-left">
              <input className="w-full px-[14px] py-[12px] text-[15px] border border-[#dcdfe4] rounded-[8px]" placeholder="Username" value={fpUser} onChange={(e) => setFpUser(e.target.value)} />
              <input type="password" className="w-full px-[14px] py-[12px] text-[15px] border border-[#dcdfe4] rounded-[8px]" placeholder="New Password" value={fpNew} onChange={(e) => setFpNew(e.target.value)} />
              <input type="password" className="w-full px-[14px] py-[12px] text-[15px] border border-[#dcdfe4] rounded-[8px]" placeholder="Confirm Password" value={fpConfirm} onChange={(e) => setFpConfirm(e.target.value)} />
            </div>
            <button onClick={resetPassword} className="w-full mt-[6px] py-[12px] px-[16px] rounded-[8px] text-[15px] font-semibold text-white bg-[#4e7ac7] hover:bg-[#436da8] transition-all active:translate-y-[0.5px]">
              Reset Password
            </button>
            <div className="text-[#e11d48] text-[14px] mt-[10px] min-h-[18px]">{fpError}</div>
          </div>
        </div>
      )}
    </div>
  );
}