"""
测试 Pool Mode
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
import time
from pathlib import Path


def test_pool_sessions_file():
    """测试session pool文件"""
    print("=" * 60)
    print("测试: Pool Sessions文件")
    print("=" * 60)

    pool_file = Path(__file__).parent.parent / "pool_sessions.json"

    if not pool_file.exists():
        print("⚠️  pool_sessions.json 不存在 - 需要先运行 session_daemon.js")
        print("   运行: cd generator && node session_daemon.js")
        return None  # Not a failure, just not ready

    try:
        with open(pool_file) as f:
            pool_data = json.load(f)

        if "sessions" not in pool_data:
            print("❌ pool_sessions.json 格式错误: 缺少'sessions'字段")
            return False

        sessions = pool_data["sessions"]
        print(f"✓ Pool文件加载成功")
        print(f"  - 总Session数: {len(sessions)}")

        # 统计有效session
        now = time.time() * 1000  # 转为毫秒
        valid_sessions = []
        expired_sessions = []

        for sess in sessions:
            try:
                expires_at = sess.get("expires_at", "")
                # Parse ISO timestamp
                from datetime import datetime
                expire_time = datetime.fromisoformat(expires_at.replace("Z", "+00:00")).timestamp() * 1000

                if expire_time > now:
                    valid_sessions.append(sess)
                else:
                    expired_sessions.append(sess)
            except Exception as e:
                print(f"  ⚠️  无法解析session过期时间: {e}")
                expired_sessions.append(sess)

        print(f"  - 有效Session: {len(valid_sessions)}")
        print(f"  - 过期Session: {len(expired_sessions)}")

        # 按账户统计
        if valid_sessions:
            by_account = {}
            for sess in valid_sessions:
                email = sess.get("account_email", "unknown")
                by_account[email] = by_account.get(email, 0) + 1

            print(f"\n  按账户分布:")
            for email, count in by_account.items():
                print(f"    - {email}: {count} sessions")

        # 验证session结构
        if valid_sessions:
            sample = valid_sessions[0]
            required_fields = ["session_id", "token", "user_id", "device_id", "account_email"]
            missing = [f for f in required_fields if f not in sample]

            if missing:
                print(f"\n  ❌ Session缺少必需字段: {missing}")
                return False

            print(f"\n✓ Session结构验证通过")

        if not valid_sessions:
            print(f"\n⚠️  没有有效session - 可能需要重新运行daemon")
            return False

        return True

    except Exception as e:
        print(f"❌ Pool文件测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_session_pool_module():
    """测试session_pool模块"""
    print("\n" + "=" * 60)
    print("测试: Session Pool模块")
    print("=" * 60)

    try:
        from minimax_adapter.pool import get_pooled_session

        print("✓ minimax_adapter模块导入成功")

        # 测试获取session
        session = get_pooled_session("", "")

        if session:
            session_id, token, user_id, device_id, uuid_val, email = session
            print(f"\n✓ 成功获取session:")
            print(f"  - Session ID: {session_id}")
            print(f"  - User ID: {user_id}")
            print(f"  - Device ID: {device_id}")
            print(f"  - Account: {email}")
            print(f"  - Token: {token[:20]}..." if token else "  - Token: None")
            return True
        else:
            print("⚠️  Pool中没有有效session")
            return None

    except ImportError as e:
        print(f"❌ 无法导入模块: {e}")
        return False
    except Exception as e:
        print(f"❌ Session pool模块测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_pool_rotation():
    """测试session pool轮转机制"""
    print("\n" + "=" * 60)
    print("测试: Session Pool轮转")
    print("=" * 60)

    try:
        from minimax_adapter.pool import get_pooled_session

        # 获取多个session，验证轮转
        sessions = []
        for i in range(3):
            sess = get_pooled_session("", "")
            if sess:
                sessions.append(sess)

        if not sessions:
            print("⚠️  Pool中没有有效session，跳过轮转测试")
            return None

        print(f"✓ 获取了 {len(sessions)} 个session")

        # 验证session来自不同账户（如果有多个账户）
        emails = [s[5] for s in sessions if s[5]]  # s[5] is email
        unique_emails = set(emails)

        if len(unique_emails) > 1:
            print(f"✓ Session来自 {len(unique_emails)} 个不同账户（负载均衡正常）")
        elif len(unique_emails) == 1:
            print(f"  ℹ️  所有session来自同一账户: {emails[0] if emails else 'unknown'}")

        return True

    except Exception as e:
        print(f"❌ Pool轮转测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    results = []

    results.append(("Pool Sessions文件", test_pool_sessions_file()))
    results.append(("Session Pool模块", test_session_pool_module()))
    results.append(("Session Pool轮转", test_pool_rotation()))

    print("\n" + "=" * 60)
    print("Pool Mode测试结果")
    print("=" * 60)

    for name, result in results:
        if result is None:
            status = "⊘ SKIP"
        elif result:
            status = "✓ PASS"
        else:
            status = "✗ FAIL"
        print(f"{status}: {name}")

    # None表示跳过，不算失败
    total = len(results)
    passed = sum(1 for _, r in results if r is True)
    failed = sum(1 for _, r in results if r is False)
    skipped = sum(1 for _, r in results if r is None)

    print(f"\n总计: {passed} 通过, {failed} 失败, {skipped} 跳过")

    sys.exit(0 if failed == 0 else 1)
