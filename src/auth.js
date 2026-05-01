import { createClient } from '@supabase/supabase-js';
import { EMAILJS_CONFIG } from './config.js';

const AUTH_SESSION_KEY = 'aegis_session';
const ADMIN_EMAIL = 'joanwilke86@gmail.com';

// Initialize Supabase
export const supabase = createClient(EMAILJS_CONFIG.SUPABASE.URL, EMAILJS_CONFIG.SUPABASE.KEY);

// Simple hash for passwords
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'pv_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Email sending service via EmailJS
async function sendEmail(to, subject, body, templateId = null, templateParams = {}) {
  if (EMAILJS_CONFIG.PUBLIC_KEY === 'TU_PUBLIC_KEY') {
    console.log('--- EMAIL SIMULATED ---');
    console.log(`To: ${to}\nSubject: ${subject}\nBody: ${body}`);
    return { success: true, simulated: true };
  }

  try {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAILJS_CONFIG.SERVICE_ID,
        template_id: templateId || EMAILJS_CONFIG.TEMPLATES.VERIFICATION,
        user_id: EMAILJS_CONFIG.PUBLIC_KEY,
        template_params: {
          to_email: to,
          user_email: to,
          email: to,
          subject: subject,
          message: body,
          passcode: templateParams.code || templateParams.passcode || '',
          ...templateParams
        }
      })
    });
    return { success: response.ok };
  } catch (error) {
    console.error('Email error:', error);
    return { success: false, error: error.message };
  }
}

export async function register(name, email, password) {
  const emailKey = email.toLowerCase().trim();
  const hashedPassword = await hashPassword(password);
  const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

  // Check if user exists
  const { data: existingUser } = await supabase
    .from('app_users')
    .select('status, created_at')
    .eq('email', emailKey)
    .single();

  if (existingUser) {
    if (existingUser.status === 'active') {
      return { success: false, error: 'Este email ya está registrado' };
    }
    // Rate limit registration attempts (1 minute)
    const lastAttempt = new Date(existingUser.created_at).getTime();
    if (Date.now() - lastAttempt < 60000) {
      return { success: false, error: 'Espera un minuto antes de intentarlo de nuevo' };
    }
    
    // Update existing pending user
    await supabase
      .from('app_users')
      .update({ 
        name, 
        password: hashedPassword, 
        verification_code: verificationCode,
        status: emailKey === ADMIN_EMAIL ? 'active' : 'pending_email',
        created_at: new Date().toISOString()
      })
      .eq('email', emailKey);
  } else {
    // Insert new user
    const { error } = await supabase
      .from('app_users')
      .insert([{
        name,
        email: emailKey,
        password: hashedPassword,
        verification_code: verificationCode,
        status: emailKey === ADMIN_EMAIL ? 'active' : 'pending_email'
      }]);
    
    if (error) return { success: false, error: error.message };
  }

  // Si es el admin, entramos directamente
  if (emailKey === ADMIN_EMAIL) {
    return { success: true, admin: true };
  }

  await sendEmail(
    emailKey, 
    'Aegis — Verifica tu cuenta', 
    `Hola ${name},\n\nTu código de verificación para Aegis es: ${verificationCode}`,
    EMAILJS_CONFIG.TEMPLATES.VERIFICATION,
    { user_name: name, code: verificationCode, passcode: verificationCode }
  );

  return { success: true };
}

export async function resendVerificationCode(email) {
  const emailKey = email.toLowerCase().trim();
  
  const { data: user, error } = await supabase
    .from('app_users')
    .select('*')
    .eq('email', emailKey)
    .single();

  if (!user || user.status !== 'pending_email') {
    return { success: false, error: 'No hay verificación pendiente' };
  }

  // Rate limit: Max 2 attempts total (we use a simple count or timestamp check)
  // Note: For real rate limiting, we should have a 'resend_attempts' column.
  // Using a simple 1-minute check based on created_at for this demo.
  const now = Date.now();
  const lastAttempt = new Date(user.created_at).getTime();
  if (now - lastAttempt < 60000) {
    return { success: false, error: 'Espera 60 segundos para pedir otro código' };
  }

  const newCode = Math.floor(100000 + Math.random() * 900000).toString();
  await supabase
    .from('app_users')
    .update({ verification_code: newCode, created_at: new Date().toISOString() })
    .eq('email', emailKey);

  await sendEmail(
    emailKey,
    'Tu nuevo código',
    `Tu nuevo código es: ${newCode}`,
    EMAILJS_CONFIG.TEMPLATES.VERIFICATION,
    { user_name: user.name, code: newCode, passcode: newCode }
  );

  return { success: true };
}

export async function verifyEmail(email, code) {
  const emailKey = email.toLowerCase().trim();
  
  const { data: user } = await supabase
    .from('app_users')
    .select('*')
    .eq('email', emailKey)
    .single();

  if (!user || user.verification_code !== code) {
    return { success: false, error: 'Código incorrecto' };
  }

  await supabase
    .from('app_users')
    .update({ status: 'pending_approval', verification_code: null })
    .eq('email', emailKey);

  // Link for admin approval
  const approvalLink = `${window.location.origin}/?approve=${btoa(emailKey)}`;

  await sendEmail(
    ADMIN_EMAIL,
    'Aegis — Nueva Solicitud de Acceso',
    `El usuario ${user.name} (${user.email}) solicita acceso a Aegis.\n\nAprobar aquí: ${approvalLink}`,
    EMAILJS_CONFIG.TEMPLATES.ADMIN_NOTIFICATION,
    { 
      user_name: 'Joan', 
      message: `El usuario ${user.name} (${user.email}) solicita acceso. Pulsa el siguiente enlace para aprobar: ${approvalLink}`,
      passcode: 'SOLICITUD',
      approval_link: approvalLink
    }
  );

  return { success: true, status: 'pending_approval' };
}

export async function approveUser(email) {
  const emailKey = email.toLowerCase().trim();
  
  const { data: user } = await supabase
    .from('app_users')
    .select('*')
    .eq('email', emailKey)
    .single();

  if (!user || user.status !== 'pending_approval') {
    return { success: false, error: 'Usuario no apto para aprobación' };
  }

  console.log('[AUTH] Generando licencia para:', user.email);
  const licenseCode = 'PV-' + Math.random().toString(36).substring(2, 10).toUpperCase();
  
  const { error: updateError } = await supabase
    .from('app_users')
    .update({ status: 'pending_license', license_code: licenseCode })
    .eq('email', emailKey);

  if (updateError) {
    console.error('[AUTH] Error al actualizar estado en Supabase:', updateError);
    return { success: false, error: 'Error al actualizar base de datos' };
  }

  console.log('[AUTH] Enviando email de licencia...');
  const emailResult = await sendEmail(
    user.email,
    'Aegis — Acceso Aprobado',
    `Hola ${user.name},\n\nTu solicitud de acceso a Aegis ha sido aprobada.\n\nTu código de licencia es: ${licenseCode}`,
    EMAILJS_CONFIG.TEMPLATES.LICENSE_CODE,
    { 
      user_name: user.name, 
      license_code: licenseCode,
      passcode: licenseCode 
    }
  );

  if (!emailResult.success) {
    console.warn('[AUTH] El usuario fue aprobado pero el email de licencia falló:', emailResult.error);
    return { success: true, licenseCode, emailError: emailResult.error };
  }

  return { success: true, licenseCode };
}

export async function verifyLicense(email, code) {
  const emailKey = email.toLowerCase().trim();
  const cleanCode = code.trim().toUpperCase();
  
  const { data: user } = await supabase
    .from('app_users')
    .select('*')
    .eq('email', emailKey)
    .single();

  if (!user || user.license_code !== cleanCode) {
    return { success: false, error: 'Licencia inválida' };
  }

  await supabase
    .from('app_users')
    .update({ status: 'active', license_code: null })
    .eq('email', emailKey);

  setSession(user);
  return { success: true, user };
}

export async function requestPasswordReset(email) {
  const emailKey = email.toLowerCase().trim();
  
  const { data: user } = await supabase
    .from('app_users')
    .select('*')
    .eq('email', emailKey)
    .single();

  if (!user) return { success: false, error: 'Email no encontrado' };

  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  
  const { error } = await supabase
    .from('app_users')
    .update({ verification_code: resetCode })
    .eq('email', emailKey);

  if (error) return { success: false, error: 'Error al generar código' };

  await sendEmail(
    emailKey,
    'Recuperación de contraseña',
    `Tu código de recuperación es: ${resetCode}`,
    EMAILJS_CONFIG.TEMPLATES.VERIFICATION,
    { user_name: user.name, code: resetCode, passcode: resetCode }
  );

  return { success: true };
}

export async function confirmPasswordReset(email, code, newPassword) {
  const emailKey = email.toLowerCase().trim();
  
  const { data: user } = await supabase
    .from('app_users')
    .select('*')
    .eq('email', emailKey)
    .single();

  if (!user || user.verification_code !== code) {
    return { success: false, error: 'Código de recuperación incorrecto' };
  }

  const hashedPassword = await hashPassword(newPassword);
  
  const { error } = await supabase
    .from('app_users')
    .update({ 
      password: hashedPassword, 
      verification_code: null,
      status: user.status === 'pending_email' ? 'pending_approval' : user.status 
    })
    .eq('email', emailKey);

  if (error) return { success: false, error: 'Error al actualizar contraseña' };

  return { success: true };
}

export async function login(email, password) {
  const emailKey = email.toLowerCase().trim();
  const hashedPassword = await hashPassword(password);

  // Especial: Login directo para Admin
  if (emailKey === ADMIN_EMAIL && password === 'Jwg14072006') {
    const adminSession = {
      id: 'admin_joan',
      name: 'Joan Admin',
      email: ADMIN_EMAIL,
      avatar: 'J',
      loginAt: Date.now()
    };
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(adminSession));
    return { success: true, user: adminSession };
  }
  
  const { data: user, error } = await supabase
    .from('app_users')
    .select('*')
    .eq('email', emailKey)
    .single();

  if (!user) return { success: false, error: 'Usuario no encontrado' };
  if (user.password !== hashedPassword) return { success: false, error: 'Contraseña incorrecta' };
  
  if (user.status !== 'active') {
    return { success: false, error: 'Tu cuenta está en proceso', status: user.status };
  }

  setSession(user);
  return { success: true, user };
}

export function logout() {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
}

function setSession(user) {
  const session = {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.name.charAt(0).toUpperCase(),
    loginAt: Date.now(),
  };
  sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

export function getSession() {
  const data = sessionStorage.getItem(AUTH_SESSION_KEY);
  return data ? JSON.parse(data) : null;
}

export function isAuthenticated() {
  return getSession() !== null;
}

export function getUserStorageKey() {
  const session = getSession();
  return session ? `pv_${session.id}` : 'pv_guest';
}

export async function deleteAccount(email) {
  const emailKey = email.toLowerCase().trim();
  const { error } = await supabase
    .from('app_users')
    .delete()
    .eq('email', emailKey);
  
  if (!error) {
    logout();
    return { success: true };
  }
  return { success: false, error: error.message };
}

// Admin Functions
export async function getAllUsers() {
  const { data, error } = await supabase
    .from('app_users')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) return { success: false, error: error.message };
  return { success: true, users: data };
}

export async function adminDeleteUser(email) {
  const { error } = await supabase
    .from('app_users')
    .delete()
    .eq('email', email);
  
  if (error) return { success: false, error: error.message };
  return { success: true };
}
