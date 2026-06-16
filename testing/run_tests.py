#!/usr/bin/env python3
"""
MiniMax2API 测试套件运行器
"""
import subprocess
import sys
from pathlib import Path


def run_test(test_file, description):
    """运行单个测试文件"""
    print(f"\n{'=' * 70}")
    print(f"运行: {description}")
    print(f"文件: {test_file}")
    print(f"{'=' * 70}")

    try:
        result = subprocess.run(
            [sys.executable, test_file],
            cwd=Path(__file__).parent.parent,
            capture_output=False,
            text=True
        )
        return result.returncode == 0
    except Exception as e:
        print(f"❌ 测试执行失败: {e}")
        return False


def main():
    print("""
╔══════════════════════════════════════════════════════════════════╗
║                 MiniMax2API 测试套件                              ║
╚══════════════════════════════════════════════════════════════════╝
""")

    test_dir = Path(__file__).parent

    tests = [
        (test_dir / "test_config.py", "配置管理测试"),
        (test_dir / "test_pool_mode.py", "Pool Mode测试"),
        (test_dir / "test_lazy_mode.py", "Lazy Mode测试"),
        (test_dir / "test_api.py", "API端到端测试"),
    ]

    results = []

    for test_file, description in tests:
        if not test_file.exists():
            print(f"⚠️  跳过: {test_file} (文件不存在)")
            results.append((description, None))
            continue

        passed = run_test(test_file, description)
        results.append((description, passed))

    # 汇总报告
    print(f"\n{'=' * 70}")
    print("最终测试报告")
    print(f"{'=' * 70}\n")

    for description, result in results:
        if result is None:
            status = "⊘ SKIP"
        elif result:
            status = "✓ PASS"
        else:
            status = "✗ FAIL"
        print(f"{status}: {description}")

    total = len(results)
    passed = sum(1 for _, r in results if r is True)
    failed = sum(1 for _, r in results if r is False)
    skipped = sum(1 for _, r in results if r is None)

    print(f"\n{'=' * 70}")
    print(f"总计: {passed} 通过, {failed} 失败, {skipped} 跳过")
    print(f"{'=' * 70}\n")

    if failed > 0:
        print("❌ 部分测试失败")
        sys.exit(1)
    elif passed == 0:
        print("⚠️  所有测试都被跳过")
        sys.exit(0)
    else:
        print("✓ 所有测试通过！")
        sys.exit(0)


if __name__ == "__main__":
    main()
