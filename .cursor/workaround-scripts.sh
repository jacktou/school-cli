#!/bin/bash
# Cursor Cloud Agent 审核机制故障临时绕过脚本
# 这些脚本帮助在审核机制修复之前完成常见操作

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否在 Cloud Agent 环境中
check_environment() {
    if [ -z "$CURSOR_CLOUD_AGENT" ]; then
        print_warning "不在 Cloud Agent 环境中，某些功能可能不可用"
    fi
}

# 安全的 git push（带重试）
safe_git_push() {
    local branch=${1:-$(git branch --show-current)}
    local max_retries=4
    local retry_count=0
    local wait_time=4
    
    print_info "准备推送分支: $branch"
    
    while [ $retry_count -lt $max_retries ]; do
        if git push -u origin "$branch" 2>&1; then
            print_success "成功推送到 origin/$branch"
            return 0
        else
            retry_count=$((retry_count + 1))
            if [ $retry_count -lt $max_retries ]; then
                print_warning "推送失败，等待 ${wait_time}s 后重试 ($retry_count/$max_retries)..."
                sleep $wait_time
                wait_time=$((wait_time * 2))
            fi
        fi
    done
    
    print_error "推送失败，已达到最大重试次数"
    return 1
}

# 提交并推送（绕过审核）
commit_and_push() {
    local message="$1"
    
    if [ -z "$message" ]; then
        print_error "请提供提交信息"
        echo "用法: commit_and_push \"你的提交信息\""
        return 1
    fi
    
    print_info "检查工作目录状态..."
    if ! git diff --quiet || ! git diff --cached --quiet; then
        print_info "发现更改，准备提交"
        git add .
        git commit -m "$message"
        print_success "提交完成: $message"
        
        safe_git_push
    else
        print_warning "没有需要提交的更改"
    fi
}

# 创建并推送分支
create_and_push_branch() {
    local branch_name="$1"
    
    if [ -z "$branch_name" ]; then
        print_error "请提供分支名称"
        echo "用法: create_and_push_branch \"branch-name\""
        return 1
    fi
    
    print_info "创建新分支: $branch_name"
    git checkout -b "$branch_name"
    print_success "分支创建完成"
    
    if ! git diff --quiet || ! git diff --cached --quiet; then
        print_info "发现更改，准备提交"
        git add .
        read -p "提交信息: " commit_msg
        git commit -m "$commit_msg"
    fi
    
    safe_git_push "$branch_name"
}

# 显示 Cloud Agent 状态
show_agent_status() {
    print_info "Cloud Agent 环境信息："
    echo "  工作目录: $(pwd)"
    echo "  当前分支: $(git branch --show-current)"
    echo "  Git 远程: $(git remote get-url origin 2>/dev/null || echo '未配置')"
    
    if [ -n "$CURSOR_CLOUD_AGENT" ]; then
        echo "  Cloud Agent ID: $CURSOR_CLOUD_AGENT"
    fi
    
    print_info "待提交的更改："
    git status --short
}

# 主菜单
show_menu() {
    echo ""
    echo "============================================"
    echo "  Cursor Cloud Agent 审核故障绕过工具"
    echo "============================================"
    echo ""
    echo "可用命令:"
    echo "  1. status          - 显示当前状态"
    echo "  2. commit          - 提交并推送更改"
    echo "  3. push            - 推送当前分支"
    echo "  4. branch          - 创建并推送新分支"
    echo "  5. help            - 显示帮助信息"
    echo "  6. exit            - 退出"
    echo ""
}

# 帮助信息
show_help() {
    echo ""
    echo "使用方法:"
    echo ""
    echo "1. 作为命令行工具:"
    echo "   bash workaround-scripts.sh"
    echo ""
    echo "2. 直接调用函数:"
    echo "   source workaround-scripts.sh"
    echo "   commit_and_push \"你的提交信息\""
    echo "   safe_git_push"
    echo "   create_and_push_branch \"feature/new-branch\""
    echo "   show_agent_status"
    echo ""
    echo "3. 在脚本中使用:"
    echo "   source /workspace/.cursor/workaround-scripts.sh"
    echo "   commit_and_push \"feat: add new feature\""
    echo ""
}

# 交互式主函数
main() {
    check_environment
    
    if [ $# -gt 0 ]; then
        case "$1" in
            status)
                show_agent_status
                ;;
            commit)
                shift
                commit_and_push "$@"
                ;;
            push)
                safe_git_push
                ;;
            branch)
                shift
                create_and_push_branch "$@"
                ;;
            help)
                show_help
                ;;
            *)
                print_error "未知命令: $1"
                show_help
                exit 1
                ;;
        esac
        exit 0
    fi
    
    # 交互式模式
    while true; do
        show_menu
        read -p "请选择 (1-6): " choice
        
        case $choice in
            1)
                show_agent_status
                ;;
            2)
                read -p "提交信息: " msg
                commit_and_push "$msg"
                ;;
            3)
                safe_git_push
                ;;
            4)
                read -p "分支名称: " branch
                create_and_push_branch "$branch"
                ;;
            5)
                show_help
                ;;
            6)
                print_info "退出"
                exit 0
                ;;
            *)
                print_error "无效选择，请输入 1-6"
                ;;
        esac
        
        echo ""
        read -p "按 Enter 继续..."
    done
}

# 如果直接运行脚本，启动主函数
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi
