' 星宠语桌宠静默启动器
' 作用：双击后不弹出任何 cmd / 终端黑框，直接以 pythonw 拉起桌宠。
' 原理：WScript.Shell.Run 的第二参数 0 = 隐藏窗口，pythonw.exe 本身无控制台。

Option Explicit

Dim fso, shell, root, pyw

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)

' 优先已验证可用的 MSYS2 pythonw（带 tkinter + Pillow）
pyw = "C:\programs\MSYS2\ucrt64\bin\pythonw.exe"

If Not fso.FileExists(pyw) Then
    ' 退路：同目录外的 pythonw，或 PATH 里的 pythonw
    pyw = "pythonw.exe"
End If

' 0 = 隐藏窗口；False = 不等待（VBS 立即退出，桌宠独立存活）
shell.Run """" & pyw & """ """ & root & "\pet_app.py""", 0, False
