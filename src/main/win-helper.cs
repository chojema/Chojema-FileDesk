// Windows helper compiled with the .NET Framework csc.exe at first run. Shows the real Explorer context menu
// and handles the Explorer file clipboard. src/main/win-helper.ts embeds this file at build time.
// A compiled host keeps the user's UI language; powershell.exe forces en-US shell menus on Korean Windows.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
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
    static Control ui;
    static bool busy;
    static TextReader input;
    static TextWriter output;
    static readonly JavaScriptSerializer json = new JavaScriptSerializer();

    /// Runs on the UI thread once the helper reports ready.
    public static Action Started;

    [STAThread]
    public static void Main()
    {
        Started = delegate
        {
            // A plain document warms the shared handlers; the helper .exe itself stays slow (~0.5 s) and slows later menus.
            string sample = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "warmup.txt");
            try { if (!File.Exists(sample)) File.WriteAllText(sample, ""); WarmUp(sample, 4); }
            catch (Exception e) { Console.Error.WriteLine(e); }
        };
        Run(Dispatch);
    }

    /// Keeps shell/clipboard callbacks on the STA, pumping messages even while
    /// stdin is idle. Only the background reader blocks; it never invokes COM.
    public static void Run(Action<string> dispatch)
    {
        var lines = new Queue<string>();
        using (var dispatcher = new Control())
        using (var context = new ApplicationContext())
        {
            // BeginInvoke requires a handle created on the UI/STA thread.
            IntPtr handle = dispatcher.Handle;
            ui = dispatcher;
            Action drain = delegate
            {
                // Shell verbs may run nested message loops (e.g. a modal property sheet).
                // A queued request must not reenter Show and overwrite its active menu.
                if (busy) return;
                busy = true;
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
                finally { busy = false; }
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
                    while ((line = In.ReadLine()) != null) enqueue(line);
                }
                catch (Exception e) { Console.Error.WriteLine(e); }
                finally { enqueue(null); }
            });
            reader.IsBackground = true;
            reader.Start();
            Write("{\"ready\":true}");
            if (Started != null) dispatcher.BeginInvoke(Started);
            Application.Run(context);
        }
    }

    /// Handles one JSON request line: {id, op: "clipGet"|"clipSet"|(menu), ...}.
    static void Dispatch(string line)
    {
        int id = 0;
        string result;
        try
        {
            var r = json.Deserialize<Dictionary<string, object>>(line);
            id = (int)Number(Get(r, "id"));
            string op = Get(r, "op") as string;
            if (op == "clipSet") result = ClipSet(Strings(Get(r, "paths")), true.Equals(Get(r, "cut")));
            else if (op == "clipGet") result = ClipGet();
            else result = Show(Strings(Get(r, "paths")), Convert.ToString(Get(r, "folder"), CultureInfo.InvariantCulture),
                Strings(Get(r, "ids")), Strings(Get(r, "labels")), true.Equals(Get(r, "extended")), Number(Get(r, "owner")));
        }
        catch (Exception e)
        {
            Write(json.Serialize(new Dictionary<string, object> { { "id", id }, { "error", e.Message } }));
            return;
        }
        Write(json.Serialize(new Dictionary<string, object> { { "id", id }, { "result", result } }));
    }

    static object Get(Dictionary<string, object> r, string key)
    {
        object v;
        return r != null && r.TryGetValue(key, out v) ? v : null;
    }

    static long Number(object o)
    {
        long n;
        return long.TryParse(Convert.ToString(o, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out n) ? n : 0;
    }

    static string[] Strings(object o)
    {
        if (o == null) return new string[0];
        var s = o as string;
        if (s != null) return new[] { s };
        var list = new List<string>();
        foreach (object x in (IEnumerable)o) list.Add(Convert.ToString(x, CultureInfo.InvariantCulture));
        return list.ToArray();
    }

    /// Puts files on the clipboard the way Explorer does; an empty list clears it.
    static string ClipSet(string[] paths, bool cut)
    {
        if (paths.Length == 0) { Clipboard.Clear(); return "ok"; }
        var files = new StringCollection();
        files.AddRange(paths);
        var data = new DataObject();
        data.SetFileDropList(files);
        data.SetData("Preferred DropEffect", new MemoryStream(new byte[] { (byte)(cut ? 2 : 5), 0, 0, 0 }));
        Clipboard.SetDataObject(data, true);
        return "ok";
    }

    /// Files on the clipboard (CF_HDROP) and whether Explorer marked them as cut, as JSON.
    static string ClipGet()
    {
        var list = Clipboard.ContainsFileDropList() ? Clipboard.GetFileDropList() : new StringCollection();
        var paths = new string[list.Count];
        list.CopyTo(paths, 0);
        bool cut = false;
        var effect = Clipboard.GetData("Preferred DropEffect") as MemoryStream;
        if (effect != null) { byte[] b = effect.ToArray(); cut = b.Length > 0 && (b[0] & 2) != 0; }
        return json.Serialize(new Dictionary<string, object> { { "paths", paths }, { "cut", cut } });
    }

    /// Builds and discards the shell menu so the first right-clicks skip the cold shell-extension load
    /// (measured: the first few builds take 0.5-1.4 s, later ones about 0.2 s).
    static void WarmUp(string path, int times)
    {
        if (busy || times <= 0) return;
        var pidls = new List<IntPtr>();
        object menuObject = null;
        IntPtr hmenu = CreatePopupMenu();
        try
        {
            IContextMenu menu = GetMenu(new[] { path }, Path.GetDirectoryName(path), IntPtr.Zero, pidls, out menuObject);
            if (menu != null) menu.QueryContextMenu(hmenu, 0, SHELL_FIRST, SHELL_LAST, CMF_NORMAL | CMF_EXPLORE);
        }
        catch (Exception e) { Console.Error.WriteLine(e); return; }
        finally
        {
            DestroyMenu(hmenu);
            if (menuObject != null) Marshal.ReleaseComObject(menuObject);
            foreach (IntPtr p in pidls) CoTaskMemFree(p);
        }
        // One pass per message, so a real request waits for at most one pass.
        ui.BeginInvoke((Action)delegate { WarmUp(path, times - 1); });
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

    // Raw UTF-8 pipes: a GUI-subsystem exe has no console whose code page could be set.
    static TextReader In
    {
        get { return input ?? (input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false))); }
    }

    public static void Write(string line)
    {
        lock (outLock)
        {
            if (output == null) output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            output.WriteLine(line);
            output.Flush();
        }
    }
}
