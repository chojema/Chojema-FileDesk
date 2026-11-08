// Windows helper run by PowerShell (Add-Type). Shows the real Explorer context menu.
// Kept in a .cs file so it can be compile-checked; src/main/win-helper.ts embeds it at build time.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public static class FdHelper
{
    [ComImport, Guid("000214E6-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellFolder
    {
        [PreserveSig] int ParseDisplayName(IntPtr hwnd, IntPtr pbc, [MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr pchEaten, out IntPtr ppidl, IntPtr attrs);
        [PreserveSig] int EnumObjects(IntPtr hwnd, int flags, out IntPtr enumIDList);
        [PreserveSig] int BindToObject(IntPtr pidl, IntPtr pbc, ref Guid riid, out IntPtr ppv);
        [PreserveSig] int BindToStorage(IntPtr pidl, IntPtr pbc, ref Guid riid, out IntPtr ppv);
        [PreserveSig] int CompareIDs(IntPtr lParam, IntPtr pidl1, IntPtr pidl2);
        [PreserveSig] int CreateViewObject(IntPtr hwndOwner, ref Guid riid, out IntPtr ppv);
        [PreserveSig] int GetAttributesOf(uint cidl, [MarshalAs(UnmanagedType.LPArray)] IntPtr[] apidl, ref uint rgfInOut);
        [PreserveSig] int GetUIObjectOf(IntPtr hwndOwner, uint cidl, [MarshalAs(UnmanagedType.LPArray)] IntPtr[] apidl, ref Guid riid, IntPtr rgfReserved, out IntPtr ppv);
        [PreserveSig] int GetDisplayNameOf(IntPtr pidl, uint flags, IntPtr strret);
        [PreserveSig] int SetNameOf(IntPtr hwnd, IntPtr pidl, [MarshalAs(UnmanagedType.LPWStr)] string name, uint flags, out IntPtr ppidlOut);
    }

    [ComImport, Guid("000214E4-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IContextMenu
    {
        [PreserveSig] int QueryContextMenu(IntPtr hmenu, uint index, uint idFirst, uint idLast, uint flags);
        [PreserveSig] int InvokeCommand(ref CMINVOKECOMMANDINFOEX info);
        [PreserveSig] int GetCommandString(UIntPtr idCmd, uint type, IntPtr reserved, StringBuilder name, int cch);
    }

    [ComImport, Guid("BCFCE0A0-EC17-11D0-8D10-00A0C90F2719"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IContextMenu3
    {
        [PreserveSig] int QueryContextMenu(IntPtr hmenu, uint index, uint idFirst, uint idLast, uint flags);
        [PreserveSig] int InvokeCommand(ref CMINVOKECOMMANDINFOEX info);
        [PreserveSig] int GetCommandString(UIntPtr idCmd, uint type, IntPtr reserved, StringBuilder name, int cch);
        [PreserveSig] int HandleMenuMsg(uint msg, IntPtr wParam, IntPtr lParam);
        [PreserveSig] int HandleMenuMsg2(uint msg, IntPtr wParam, IntPtr lParam, out IntPtr result);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct CMINVOKECOMMANDINFOEX
    {
        public int cbSize;
        public uint fMask;
        public IntPtr hwnd;
        public IntPtr lpVerb;
        [MarshalAs(UnmanagedType.LPStr)] public string lpParameters;
        [MarshalAs(UnmanagedType.LPStr)] public string lpDirectory;
        public int nShow;
        public uint dwHotKey;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.LPStr)] public string lpTitle;
        public IntPtr lpVerbW;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpParametersW;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpDirectoryW;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpTitleW;
        public POINT ptInvoke;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHParseDisplayName(string name, IntPtr bindingContext, out IntPtr pidl, uint sfgaoIn, out uint psfgaoOut);
    [DllImport("shell32.dll")]
    static extern int SHBindToParent(IntPtr pidl, ref Guid riid, out IntPtr ppv, out IntPtr pidlLast);
    [DllImport("shell32.dll")]
    static extern int SHGetDesktopFolder(out IntPtr ppshf);
    [DllImport("ole32.dll")]
    static extern void CoTaskMemFree(IntPtr pv);
    [DllImport("user32.dll")]
    static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll")]
    static extern bool DestroyMenu(IntPtr hMenu);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool AppendMenuW(IntPtr hMenu, uint flags, UIntPtr id, string item);
    [DllImport("user32.dll")]
    static extern int GetMenuItemCount(IntPtr hMenu);
    [DllImport("user32.dll")]
    static extern uint TrackPopupMenuEx(IntPtr hmenu, uint flags, int x, int y, IntPtr hwnd, IntPtr tpm);
    [DllImport("user32.dll")]
    static extern bool GetCursorPos(out POINT pt);
    [DllImport("user32.dll")]
    static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    static extern bool AttachThreadInput(uint attach, uint attachTo, bool fAttach);
    [DllImport("user32.dll")]
    static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);

    static readonly Guid IID_IShellFolder = new Guid("000214E6-0000-0000-C000-000000000046");
    static readonly Guid IID_IContextMenu = new Guid("000214E4-0000-0000-C000-000000000046");
    const uint MF_STRING = 0, MF_GRAYED = 1, MF_SEPARATOR = 0x800;
    const uint TPM_RETURNCMD = 0x100, TPM_RIGHTBUTTON = 2;
    const uint CMF_NORMAL = 0, CMF_EXPLORE = 4, CMF_EXTENDEDVERBS = 0x100;
    const uint SHELL_FIRST = 1000, SHELL_LAST = 0x7FFF;

    sealed class MenuHost : NativeWindow
    {
        public IContextMenu3 Menu3;
        public MenuHost() { CreateHandle(new CreateParams()); }
        protected override void WndProc(ref Message m)
        {
            // Send To, Open With and owner-drawn items fill themselves through these messages.
            if (Menu3 != null && (m.Msg == 0x117 || m.Msg == 0x2B || m.Msg == 0x2C || m.Msg == 0x120))
            {
                IntPtr result;
                if (Menu3.HandleMenuMsg2((uint)m.Msg, m.WParam, m.LParam, out result) == 0) { m.Result = result; return; }
            }
            base.WndProc(ref m);
        }
    }

    static MenuHost host;

    /// Keeps shell/clipboard callbacks on the PowerShell STA, pumping messages even while
    /// stdin is idle. Only the background reader blocks; it never invokes PowerShell or COM.
    public static void Run(Action<string> dispatch)
    {
        var lines = new Queue<string>();
        using (var dispatcher = new Control())
        using (var context = new ApplicationContext())
        {
            // BeginInvoke requires a handle created on the UI/STA thread.
            IntPtr handle = dispatcher.Handle;
            bool dispatching = false;
            Action drain = delegate
            {
                // Shell verbs may run nested message loops (e.g. a modal property sheet).
                // A queued request must not reenter Show and overwrite its active menu.
                if (dispatching) return;
                dispatching = true;
                try
                {
                    while (true)
                    {
                        string line;
                        lock (lines)
                        {
                            if (lines.Count == 0) return;
                            line = lines.Dequeue();
                        }
                        if (line == null) { context.ExitThread(); return; }
                        dispatch(line);
                    }
                }
                catch (Exception e)
                {
                    Console.Error.WriteLine(e);
                    context.ExitThread();
                }
                finally { dispatching = false; }
            };
            Action<string> enqueue = delegate(string line)
            {
                lock (lines) { lines.Enqueue(line); }
                try { dispatcher.BeginInvoke(drain); }
                catch (InvalidOperationException) { /* The UI thread has exited. */ }
            };
            var reader = new Thread(delegate()
            {
                try
                {
                    string line;
                    while ((line = Console.In.ReadLine()) != null) enqueue(line);
                }
                catch (Exception e) { Console.Error.WriteLine(e); }
                finally { enqueue(null); }
            });
            reader.IsBackground = true;
            reader.Start();
            Write("{\"ready\":true}");
            Application.Run(context);
        }
    }

    /// Shows app items followed by the Explorer menu for paths (or for folder's background when paths is empty).
    /// Returns "app:<id>", "shell" when a shell command ran, or "none".
    public static string Show(string[] paths, string folder, string[] ids, string[] labels, bool extended, long ownerValue)
    {
        // Use the requesting FileDesk window, not whichever app happens to be foreground
        // when this queued request is processed.
        IntPtr owner = IntPtr.Size == 8 ? new IntPtr(ownerValue) : new IntPtr(unchecked((int)ownerValue));
        if (owner == IntPtr.Zero || !IsWindow(owner)) return "none";
        if (host == null) host = new MenuHost();
        var pidls = new List<IntPtr>();
        IntPtr hmenu = CreatePopupMenu();
        object menuObject = null;
        uint pid;
        uint fgThread = GetWindowThreadProcessId(owner, out pid);
        uint self = GetCurrentThreadId();
        bool attached = false;
        try
        {
            for (int i = 0; i < ids.Length; i++)
            {
                if (ids[i] == "-") AppendMenuW(hmenu, MF_SEPARATOR, UIntPtr.Zero, null);
                else AppendMenuW(hmenu, MF_STRING, (UIntPtr)(uint)(i + 1), labels[i]);
            }
            IContextMenu menu = GetMenu(paths ?? new string[0], folder, owner, pidls, out menuObject);
            if (menu != null)
            {
                if (ids.Length > 0) AppendMenuW(hmenu, MF_SEPARATOR, UIntPtr.Zero, null);
                menu.QueryContextMenu(hmenu, (uint)GetMenuItemCount(hmenu), SHELL_FIRST, SHELL_LAST, CMF_NORMAL | CMF_EXPLORE | (extended ? CMF_EXTENDEDVERBS : 0));
                host.Menu3 = menuObject as IContextMenu3;
            }
            POINT pt;
            GetCursorPos(out pt);
            if (fgThread != 0 && fgThread != self) attached = AttachThreadInput(self, fgThread, true);
            uint cmd;
            try
            {
                SetForegroundWindow(host.Handle);
                cmd = TrackPopupMenuEx(hmenu, TPM_RETURNCMD | TPM_RIGHTBUTTON, pt.X, pt.Y, host.Handle, IntPtr.Zero);
                PostMessage(host.Handle, 0, IntPtr.Zero, IntPtr.Zero);
            }
            finally
            {
                // Never keep FileDesk's input queue attached while a shell verb opens UI.
                if (attached) { AttachThreadInput(self, fgThread, false); attached = false; }
                if (IsWindow(owner)) SetForegroundWindow(owner);
            }
            if (cmd == 0) return "none";
            if (cmd < SHELL_FIRST) return "app:" + ids[cmd - 1];
            var info = new CMINVOKECOMMANDINFOEX();
            info.cbSize = Marshal.SizeOf(typeof(CMINVOKECOMMANDINFOEX));
            info.fMask = 0x4000 | 0x20000000; // CMIC_MASK_UNICODE | CMIC_MASK_PTINVOKE
            info.hwnd = owner;
            info.lpVerb = (IntPtr)(cmd - SHELL_FIRST);
            info.lpVerbW = (IntPtr)(cmd - SHELL_FIRST);
            info.lpDirectory = folder;
            info.lpDirectoryW = folder;
            info.nShow = 1;
            info.ptInvoke = pt;
            int hr = menu.InvokeCommand(ref info);
            if (hr != 0) throw new Exception("InvokeCommand failed: 0x" + hr.ToString("X8"));
            return "shell";
        }
        finally
        {
            host.Menu3 = null;
            if (attached) AttachThreadInput(self, fgThread, false);
            DestroyMenu(hmenu);
            if (menuObject != null) Marshal.ReleaseComObject(menuObject);
            foreach (IntPtr p in pidls) CoTaskMemFree(p);
        }
    }

    static IContextMenu GetMenu(string[] paths, string folder, IntPtr owner, List<IntPtr> pidls, out object menuObject)
    {
        menuObject = null;
        Guid iidFolder = IID_IShellFolder, iidMenu = IID_IContextMenu;
        IntPtr ppv;
        if (paths.Length == 0)
        {
            IntPtr pidl; uint attrs;
            if (SHParseDisplayName(folder, IntPtr.Zero, out pidl, 0, out attrs) != 0) return null;
            pidls.Add(pidl);
            IntPtr desktopPtr;
            if (SHGetDesktopFolder(out desktopPtr) != 0) return null;
            var desktop = (IShellFolder)Marshal.GetObjectForIUnknown(desktopPtr);
            Marshal.Release(desktopPtr);
            if (desktop.BindToObject(pidl, IntPtr.Zero, ref iidFolder, out ppv) != 0) return null;
            var shellFolder = (IShellFolder)Marshal.GetObjectForIUnknown(ppv);
            Marshal.Release(ppv);
            if (shellFolder.CreateViewObject(owner, ref iidMenu, out ppv) != 0) return null;
        }
        else
        {
            IShellFolder parent = null;
            var children = new IntPtr[paths.Length];
            for (int i = 0; i < paths.Length; i++)
            {
                IntPtr pidl; uint attrs;
                int hr = SHParseDisplayName(paths[i], IntPtr.Zero, out pidl, 0, out attrs);
                if (hr != 0) throw new Exception("Cannot open " + paths[i]);
                pidls.Add(pidl);
                IntPtr parentPtr, last;
                if (SHBindToParent(pidl, ref iidFolder, out parentPtr, out last) != 0) throw new Exception("Cannot open " + paths[i]);
                if (parent == null) parent = (IShellFolder)Marshal.GetObjectForIUnknown(parentPtr);
                Marshal.Release(parentPtr);
                children[i] = last;
            }
            if (parent.GetUIObjectOf(owner, (uint)children.Length, children, ref iidMenu, IntPtr.Zero, out ppv) != 0) return null;
        }
        menuObject = Marshal.GetObjectForIUnknown(ppv);
        Marshal.Release(ppv);
        return menuObject as IContextMenu;
    }

    static readonly object outLock = new object();

    public static void Write(string line)
    {
        lock (outLock) { Console.Out.WriteLine(line); Console.Out.Flush(); }
    }
}
